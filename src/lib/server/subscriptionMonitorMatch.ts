/**
 * Decides whether a subscriber who chose some monitors should hear of an event.
 *
 * - A subscriber with no chosen monitors hears of every event.
 * - An event with no monitors (a site-wide announcement) reaches every subscriber.
 * - Otherwise the subscriber hears of the event when a chosen monitor and an event monitor
 *   meet, after both sides are widened with the members of any group monitor among them.
 *   So choosing a group covers its members, and an event on a group reaches the
 *   subscribers of its members.
 */

/** Group monitor tag -> tags of its member monitors. */
export type GroupMembers = Map<string, string[]>;

export function ExpandWithGroupMembers(tags: Iterable<string>, groupMembers: GroupMembers): Set<string> {
  const result = new Set<string>();
  const stack = [...tags];
  while (stack.length > 0) {
    const tag = stack.pop() as string;
    if (result.has(tag)) continue;
    result.add(tag);
    for (const member of groupMembers.get(tag) ?? []) {
      if (!result.has(member)) stack.push(member);
    }
  }
  return result;
}

export function SubscriberWantsEvent(
  chosenTags: string[] | undefined,
  eventTags: string[] | null | undefined,
  groupMembers: GroupMembers,
): boolean {
  if (!chosenTags || chosenTags.length === 0) return true;
  if (!eventTags || eventTags.length === 0) return true;
  const chosen = ExpandWithGroupMembers(chosenTags, groupMembers);
  for (const tag of ExpandWithGroupMembers(eventTags, groupMembers)) {
    if (chosen.has(tag)) return true;
  }
  return false;
}
