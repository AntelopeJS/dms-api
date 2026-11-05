--------------------------- MODULE RouteStatistics ---------------------------
(***************************************************************************)
(* The per-route statistics rollup of @antelopejs/dms-api: one row of the *)
(* routes_statistics table, written by addRequestStatistics on every       *)
(* replica and by the hourly pruneAllStatistics. The files are under src/:*)
(* services/statistics-write.ts, services/statistics-prune.ts and         *)
(* db/models/routes_statistics.model.ts.                                  *)
(*                                                                         *)
(* A replica writes the requests of one route one batch at a time: a      *)
(* request joins the batch still open, and a batch closes as its write    *)
(* starts (statistics-write.ts:222-248). A write reads the row, then      *)
(* inserts it or replaces its statistics under a revision guard, and      *)
(* retries from a fresh read when another writer got there first          *)
(* (statistics-write.ts:177-197). A prune rewrites the row without the    *)
(* days below its cutoff, under the same guard (statistics-prune.ts:24-41).*)
(*                                                                         *)
(* One database call is one step: a read, or the database applying or    *)
(* refusing one insert or one guarded replace. Its answer reaches the     *)
(* caller in a later step, or is lost: the caller then sees "unknown", or *)
(* an error for an insert, and the call may still apply later, or never.  *)
(* Time moves in days.                                                    *)
(***************************************************************************)
EXTENDS Integers, TLC

CONSTANTS
  Replicas,     \* processes running the module, each with its own openBatches and lastWrites
  Requests,     \* requests to the route; capture.ts:394-401 records each one once
  Pruners,      \* runs of pruneAllStatistics, each at a time of TLC's choosing (index.ts:68-71)
  Seed,         \* a request counted before the run, on day 0
  Lifetime,     \* statisticsLifetime, in days
  MaxDay,       \* the last day
  MaxAttempts,  \* MAX_STATISTICS_WRITE_ATTEMPTS (statistics-write.ts:123)
  MaxLost       \* answers the database loses in one behaviour

Actors == Replicas \cup Pruners
Counted == Requests \cup {Seed}
Days == 0..MaxDay

VARIABLES
  now,      \* getTodayTimestamp(), in days (statistics-utils.ts:6-10)
  exists,   \* whether the row is stored
  rev,      \* its revision; 0 is a row written before the field existed
  row,      \* its statistics: per day, how many times each request is counted
  open,     \* each replica's batch still open to requests (openBatches)
  batch,    \* the requests of each replica's write in flight
  wpc,      \* where each replica's write is
  wday,     \* the `today` of each replica's write (statistics-write.ts:182)
  attempt,  \* the attempt of each actor's loop
  mut,      \* each actor's insert or replace in flight
  orphan,   \* a call whose answer was lost and that may still apply
  ppc,      \* where each prune is
  pcut,     \* its cutoff (statistics-prune.ts:51-53)
  lost,
  fate,     \* what each request's write settled with
  day,      \* the day each request was written under
  erased,   \* an applied call lowered a count no prune may drop
  lostDay   \* an applied prune dropped a day at or above its cutoff

vars == <<now, exists, rev, row, open, batch, wpc, wday, attempt, mut, orphan,
          ppc, pcut, lost, fate, day, erased, lostDay>>

Empty == [d \in Days |-> [x \in Counted |-> 0]]
SeedRow == [d \in Days |-> [x \in Counted |-> IF d = 0 /\ x = Seed THEN 1 ELSE 0]]
NoCall == [st |-> "none", kind |-> "none", exp |-> 0, val |-> Empty, cut |-> 0]

(* A day has an entry in the statistics array once a request is counted  *)
(* on it (statistics-write.ts:103-109).                                   *)
Present(r, d) == \E x \in Counted : r[d][x] > 0

(* updateRouteStats folds each request of the batch into today's entry   *)
(* (statistics-write.ts:98-110, 190), as insertRouteStats does into a    *)
(* new row (lines 152-154).                                               *)
Fold(r, b, t) ==
  [d \in Days |-> [x \in Counted |-> r[d][x] + (IF d = t /\ x \in b THEN 1 ELSE 0)]]

(* pruneOldStats drops the days below the cutoff (statistics-prune.ts:15).*)
Expired(d, c) == d < c
Drop(r, c) == [d \in Days |-> IF Expired(d, c) THEN [x \in Counted |-> 0] ELSE r[d]]

RECURSIVE SumFrom(_, _)
SumFrom(x, d) == IF d > MaxDay THEN 0 ELSE row[d][x] + SumFrom(x, d + 1)
Total(x) == SumFrom(x, 0)

Init ==
  /\ now = 0
  /\ \/ exists = FALSE /\ rev = 0 /\ row = Empty
     \/ exists = TRUE /\ rev \in {0, 1} /\ row = SeedRow
  /\ open = [p \in Replicas |-> {}]
  /\ batch = [p \in Replicas |-> {}]
  /\ wpc = [p \in Replicas |-> "idle"]
  /\ wday = [p \in Replicas |-> 0]
  /\ attempt = [a \in Actors |-> 0]
  /\ mut = [a \in Actors |-> NoCall]
  /\ orphan = NoCall
  /\ ppc = [q \in Pruners |-> "idle"]
  /\ pcut = [q \in Pruners |-> 0]
  /\ lost = 0
  /\ fate = [r \in Requests |-> "none"]
  /\ day = [r \in Requests |-> 0]
  /\ erased = FALSE /\ lostDay = FALSE

TypeOK ==
  /\ now \in Days
  /\ exists \in BOOLEAN
  /\ row \in [Days -> [Counted -> 0..3]]
  /\ \A p \in Replicas : wpc[p] \in {"idle", "read", "await"}
  /\ \A q \in Pruners : ppc[q] \in {"idle", "read", "await", "done"}
  /\ \A a \in Actors : mut[a].st \in {"none", "sent", "applied", "refused"}
  /\ \A r \in Requests : fate[r] \in {"none", "pending", "resolved", "unknown", "failed"}

(* ------------------------------ database ------------------------------- *)

(* An insert fails with a duplicate key on a stored row (statistics-      *)
(* write.ts:156-165). A replace applies only while the row still carries  *)
(* the revision it was read with, the absent one included                 *)
(* (routes_statistics.model.ts:14-24, 47-51).                             *)
Applies(m) == IF m.kind = "insert" THEN ~exists ELSE exists /\ rev = m.exp

(* Each write installs a fresh revision (randomUUID, routes_statistics.   *)
(* model.ts:21, statistics-write.ts:161), so no revision is seen twice.   *)
Install(m) ==
  /\ exists' = TRUE
  /\ rev' = rev + 1
  /\ row' = m.val
  /\ erased' = \/ erased
               \/ \E d \in Days, x \in Counted :
                    m.val[d][x] < row[d][x] /\ ~(m.kind = "prune" /\ d < m.cut)
  /\ lostDay' = \/ lostDay
                \/ /\ m.kind = "prune"
                   /\ \E d \in Days : d >= m.cut /\ Present(row, d) /\ ~Present(m.val, d)

Kept == UNCHANGED <<exists, rev, row, erased, lostDay>>

(* The database applies or refuses a call in flight.                     *)
DbApply(a) ==
  /\ mut[a].st = "sent"
  /\ IF Applies(mut[a])
     THEN Install(mut[a]) /\ mut' = [mut EXCEPT ![a].st = "applied"]
     ELSE Kept /\ mut' = [mut EXCEPT ![a].st = "refused"]
  /\ UNCHANGED <<now, open, batch, wpc, wday, attempt, orphan, ppc, pcut, lost,
                 fate, day>>

(* A call whose answer was lost applies late, or is refused.             *)
OrphanApply ==
  /\ orphan.st = "sent"
  /\ IF Applies(orphan) THEN Install(orphan) ELSE Kept
  /\ orphan' = NoCall
  /\ UNCHANGED <<now, open, batch, wpc, wday, attempt, mut, ppc, pcut, lost, fate,
                 day>>

(* ------------------------------- writer -------------------------------- *)

(* A request joins its replica's open batch, or opens one                *)
(* (statistics-write.ts:226-238, called from capture.ts:133).            *)
Arrive(r, p) ==
  /\ fate[r] = "none"
  /\ fate' = [fate EXCEPT ![r] = "pending"]
  /\ open' = [open EXCEPT ![p] = @ \cup {r}]
  /\ UNCHANGED <<now, exists, rev, row, batch, wpc, wday, attempt, mut, orphan,
                 ppc, pcut, lost, day, erased, lostDay>>

(* Once the replica's previous write settled, the open batch closes and  *)
(* its write starts with today's date (statistics-write.ts:233-236, 182).*)
WriteStart(p) ==
  /\ wpc[p] = "idle"
  /\ open[p] # {}
  /\ batch' = [batch EXCEPT ![p] = open[p]]
  /\ open' = [open EXCEPT ![p] = {}]
  /\ wday' = [wday EXCEPT ![p] = now]
  /\ day' = [r \in Requests |-> IF r \in open[p] THEN now ELSE day[r]]
  /\ attempt' = [attempt EXCEPT ![p] = 0]
  /\ wpc' = [wpc EXCEPT ![p] = "read"]
  /\ UNCHANGED <<now, exists, rev, row, mut, orphan, ppc, pcut, lost, fate,
                 erased, lostDay>>

(* model.get, then an insert of a new row or the guarded replace of the  *)
(* row it read with the batch folded in (statistics-write.ts:185-191).   *)
WriteRead(p) ==
  /\ wpc[p] = "read"
  /\ mut' = [mut EXCEPT ![p] =
       IF exists
       THEN [st |-> "sent", kind |-> "replace", exp |-> rev,
             val |-> Fold(row, batch[p], wday[p]), cut |-> 0]
       ELSE [st |-> "sent", kind |-> "insert", exp |-> 0,
             val |-> Fold(Empty, batch[p], wday[p]), cut |-> 0]]
  /\ wpc' = [wpc EXCEPT ![p] = "await"]
  /\ UNCHANGED <<now, exists, rev, row, open, batch, wday, attempt, orphan, ppc,
                 pcut, lost, fate, day, erased, lostDay>>

(* The write settles: every request of the batch gets its fate, and the  *)
(* next batch may start (statistics-write.ts:239-246).                   *)
Settle(p, f) ==
  /\ fate' = [r \in Requests |-> IF r \in batch[p] THEN f ELSE fate[r]]
  /\ batch' = [batch EXCEPT ![p] = {}]
  /\ wpc' = [wpc EXCEPT ![p] = "idle"]
  /\ wday' = [wday EXCEPT ![p] = 0]
  /\ attempt' = [attempt EXCEPT ![p] = 0]

(* A stored insert or an "applied" replace resolves the write. A        *)
(* duplicate key or "not-applied" retries from a fresh read, up to       *)
(* MAX_STATISTICS_WRITE_ATTEMPTS, then throws (statistics-write.ts:183-  *)
(* 196).                                                                  *)
WriteAnswer(p) ==
  /\ wpc[p] = "await"
  /\ mut[p].st \in {"applied", "refused"}
  /\ mut' = [mut EXCEPT ![p] = NoCall]
  /\ IF mut[p].st = "applied"
     THEN Settle(p, "resolved")
     ELSE IF attempt[p] + 1 < MaxAttempts
          THEN /\ attempt' = [attempt EXCEPT ![p] = @ + 1]
               /\ wpc' = [wpc EXCEPT ![p] = "read"]
               /\ UNCHANGED <<batch, wday, fate>>
          ELSE Settle(p, "failed")
  /\ UNCHANGED <<now, exists, rev, row, open, orphan, ppc, pcut, lost, day,
                 erased, lostDay>>

(* The answer is lost. replaceStatistics answers "unknown" and the write *)
(* returns without a retry (statistics-write.ts:192); an insert throws   *)
(* (line 166).                                                            *)
WriteLost(p) ==
  /\ wpc[p] = "await"
  /\ lost < MaxLost
  /\ lost' = lost + 1
  /\ orphan' = IF mut[p].st = "sent" THEN mut[p] ELSE orphan
  /\ mut' = [mut EXCEPT ![p] = NoCall]
  /\ Settle(p, IF mut[p].kind = "insert" THEN "failed" ELSE "unknown")
  /\ UNCHANGED <<now, exists, rev, row, open, ppc, pcut, day, erased, lostDay>>

(* ------------------------------- prune --------------------------------- *)

(* The hourly cron of a replica runs pruneAllStatistics (index.ts:68-71),*)
(* whose cutoff is today minus the retention (statistics-prune.ts:51-53).*)
PruneStart(q) ==
  /\ ppc[q] = "idle"
  /\ pcut' = [pcut EXCEPT ![q] = now - Lifetime]
  /\ ppc' = [ppc EXCEPT ![q] = "read"]
  /\ UNCHANGED <<now, exists, rev, row, open, batch, wpc, wday, attempt, mut,
                 orphan, lost, fate, day, erased, lostDay>>

(* getAll, or get after a conflict (statistics-prune.ts:55, 38). A row   *)
(* with no day below the cutoff is left alone (lines 31-33); otherwise   *)
(* the guarded replace writes it without those days (lines 32-35).       *)
PruneRead(q) ==
  /\ ppc[q] = "read"
  /\ IF exists /\ \E d \in Days : Expired(d, pcut[q]) /\ Present(row, d)
     THEN /\ mut' = [mut EXCEPT ![q] =
               [st |-> "sent", kind |-> "prune", exp |-> rev,
                val |-> Drop(row, pcut[q]), cut |-> pcut[q]]]
          /\ ppc' = [ppc EXCEPT ![q] = "await"]
     ELSE /\ ppc' = [ppc EXCEPT ![q] = "done"]
          /\ UNCHANGED mut
  /\ UNCHANGED <<now, exists, rev, row, open, batch, wpc, wday, attempt, orphan,
                 pcut, lost, fate, day, erased, lostDay>>

(* "applied" ends the route; "not-applied" re-reads it after a delay, up *)
(* to MAX_STATISTICS_WRITE_ATTEMPTS (statistics-prune.ts:30, 36-40).     *)
PruneAnswer(q) ==
  /\ ppc[q] = "await"
  /\ mut[q].st \in {"applied", "refused"}
  /\ mut' = [mut EXCEPT ![q] = NoCall]
  /\ IF mut[q].st = "refused" /\ attempt[q] + 1 < MaxAttempts
     THEN /\ attempt' = [attempt EXCEPT ![q] = @ + 1]
          /\ ppc' = [ppc EXCEPT ![q] = "read"]
     ELSE /\ ppc' = [ppc EXCEPT ![q] = "done"]
          /\ UNCHANGED attempt
  /\ UNCHANGED <<now, exists, rev, row, open, batch, wpc, wday, orphan, pcut,
                 lost, fate, day, erased, lostDay>>

(* The answer is lost: "unknown" ends the route (statistics-prune.ts:36).*)
PruneLost(q) ==
  /\ ppc[q] = "await"
  /\ lost < MaxLost
  /\ lost' = lost + 1
  /\ orphan' = IF mut[q].st = "sent" THEN mut[q] ELSE orphan
  /\ mut' = [mut EXCEPT ![q] = NoCall]
  /\ ppc' = [ppc EXCEPT ![q] = "done"]
  /\ UNCHANGED <<now, exists, rev, row, open, batch, wpc, wday, attempt, pcut,
                 fate, day, erased, lostDay>>

(* ------------------------------- clock --------------------------------- *)

Tick ==
  /\ now < MaxDay
  /\ now' = now + 1
  /\ UNCHANGED <<exists, rev, row, open, batch, wpc, wday, attempt, mut, orphan,
                 ppc, pcut, lost, fate, day, erased, lostDay>>

Busy ==
  \/ \E r \in Requests, p \in Replicas : Arrive(r, p)
  \/ \E p \in Replicas :
       WriteStart(p) \/ WriteRead(p) \/ WriteAnswer(p) \/ WriteLost(p)
  \/ \E a \in Actors : DbApply(a)
  \/ OrphanApply
  \/ \E q \in Pruners : PruneStart(q) \/ PruneRead(q) \/ PruneAnswer(q) \/ PruneLost(q)
  \/ Tick

(* Once nothing can happen, the system stays as it is. This step keeps   *)
(* /statechart from reading the end as a deadlock.                       *)
Settled == ~ENABLED Busy /\ UNCHANGED vars

Next == Busy \/ Settled

Spec == Init /\ [][Next]_vars

Symmetry == Permutations(Replicas) \cup Permutations(Requests) \cup Permutations(Pruners)

(* -------------------------------- rules -------------------------------- *)

(* A request is counted at most once.                                    *)
AtMostOnce == \A r \in Requests : Total(r) <= 1

(* A request whose write resolved on a definite answer is counted        *)
(* exactly once, unless its day has fallen below today's cutoff.         *)
ResolvedCountedOnce ==
  \A r \in Requests :
    fate[r] = "resolved" /\ day[r] >= now - Lifetime => Total(r) = 1

(* A prune never removes a day at or above its cutoff.                   *)
PruneKeepsRetainedDays == ~lostDay

(* No write erases another writer's counts: a count leaves the row only  *)
(* when a prune drops its day below the cutoff.                          *)
NoErasedCounts == ~erased

=============================================================================
