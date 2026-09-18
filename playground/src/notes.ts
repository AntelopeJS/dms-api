import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Post,
} from "@antelopejs/interface-api";
import {
  BasicDataModel,
  Field,
  GetModel,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { Form, formSchema } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { HttpMethod } from "@antelopejs/interface-dms/base/types";

export const PLAYGROUND_SCHEMA = "playground";

const notesTableName = "notes";

/**
 * Minimal table + form + API route registered by the playground (a local
 * module), so the route shows up under the "own" scope in the monitoring
 * pages. Submitting the form POSTs to /playground/notes which stores the
 * message here.
 */
@RegisterTable(notesTableName, PLAYGROUND_SCHEMA)
export class Note extends Table {
  @Field("string")
  declare message: string;

  @Field("date")
  declare createdAt: Date;
}

export class NoteModel extends BasicDataModel(Note, notesTableName) {}

const notesForm = Form({
  fields: [
    {
      id: "message",
      label: "Message",
      description: "Stored in the playground `notes` table.",
      type: new DefaultDataTypes.StringType({
        placeholder: "Hello from the playground",
        maxLength: 500,
      }),
      required: true,
    },
  ],
  fetchUrl: "/playground/notes",
  submitUrl: "/playground/notes",
  submitUrlMethod: HttpMethod.post,
});

const notesFormSchema = formSchema(notesForm);

export class NotesController extends Controller("/playground/notes") {
  @Get("")
  async latest() {
    const notes = await GetModel(NoteModel).getAll();
    const last = notes.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[notes.length - 1];
    return { message: last?.message ?? "" };
  }

  @Post("")
  async create(@JSONBody() body: unknown) {
    const parsed = notesFormSchema.safeParse(body);
    if (!parsed.success) {
      return new HTTPResult(400, { error: "Invalid form payload" });
    }
    await GetModel(NoteModel).insert({
      message: String(parsed.data.message),
      createdAt: new Date(),
    });
    return this.latest();
  }
}

@RegisterPage()
export class PlaygroundNotesPage extends PageController(
  "notes",
  {
    displayName: "Notes",
    icon: "i-ph-note",
    category: pagesCategory,
    order: 1,
    description: "Own-route test form",
  },
  DefaultLayout(),
) {
  static content = notesForm;
}
