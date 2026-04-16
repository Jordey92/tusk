export type StructuredValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | StructuredValue[]
  | { [key: string]: StructuredValue };

export type StructuredContext = Record<string, StructuredValue>;
