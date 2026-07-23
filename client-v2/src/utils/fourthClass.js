// Shared helper for "is this class_code some flavor of 4th Class" — 4th Class is
// sold as two independently-purchasable papers (fourth_a, fourth_b) rather than one
// combined product, so every place that used to check `=== 'fourth'` needs to
// recognize either instead of one fixed string.
export const FOURTH_CLASS_CODES = ['fourth_a', 'fourth_b'];

export function isFourthClassCode(classCode) {
  return FOURTH_CLASS_CODES.includes(classCode);
}
