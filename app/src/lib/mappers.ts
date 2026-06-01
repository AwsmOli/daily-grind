import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";

export const asDate = (value: unknown): Date | null => {
  if (!value) return null;

  if (value instanceof Date) return value;

  if (
    typeof value === "object" &&
    value &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate() as Date;
  }

  return null;
};

export const readDocData = <T extends DocumentData>(
  doc: QueryDocumentSnapshot<DocumentData>,
): T => {
  return doc.data() as T;
};
