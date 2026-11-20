/** What a trigger emitted, in order, and the `emit` it was armed with. */
export function recorder<T>() {
  const emitted: T[] = [];
  return {
    emitted,
    emit: (payload: T) => {
      emitted.push(payload);
    },
  };
}

/** A reader answering `answers` one call each, a thrown error for an Error; the last one again after. */
export function sequence<T>(...answers: Array<T | Error>) {
  let calls = 0;
  const read = () => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
  return { read, calls: () => calls };
}
