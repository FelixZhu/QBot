import { z } from "zod";

/** Who may see a card. This feed only carries fictional public demos. */
export const audienceSchema = z.enum(["fictional-public"]);

export const sourceSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["family-demo", "friend-demo", "creator-demo"]),
}).strict();

export const actionSchema = z.enum(["open", "play-demo", "interest", "dismiss", "later"]);

const base = {
  id: z.string().min(1),
  audience: audienceSchema,
  source: sourceSchema,
  actions: z.array(actionSchema).min(1),
  fictional: z.literal(true),
  kicker: z.string().min(1),
  title: z.string().min(1),
  note: z.string().min(1),
};

export const galleryCardSchema = z.object({
  ...base,
  type: z.literal("gallery"),
  frames: z.array(z.enum(["meadow", "island", "crystal", "film"])).min(2),
  caption: z.string().min(1),
}).strict();

export const inviteCardSchema = z.object({
  ...base,
  type: z.literal("invite"),
  frame: z.literal("island"),
  gameTitle: z.string().min(1),
  gameNote: z.string().min(1),
}).strict();

export const filmCardSchema = z.object({
  ...base,
  type: z.literal("film"),
  frame: z.literal("film"),
  durationLabel: z.string().min(1),
}).strict();

export const cardSchema = z.discriminatedUnion("type", [
  galleryCardSchema,
  inviteCardSchema,
  filmCardSchema,
]);

export const feedSchema = z.array(cardSchema).min(1);

export type FeedCard = z.infer<typeof cardSchema>;
export type FrameId = "meadow" | "island" | "crystal" | "film";

export function parseFeed(input: unknown): FeedCard[] {
  return feedSchema.parse(input);
}
