export function extractTrip(tag: string) {
  const match = tag.match(
    /LDT-([A-Z0-9]+)-(\d+)/i
  );

  if (!match) return null;

  return {
    contract: match[1],
    trip: match[2],
  };
}