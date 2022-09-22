export type DateInputs = [number, number][];

export interface DateMetadata {
  year: number;
  day: number;
  unix: number;
}
export interface DatesTestData {
  data: DateMetadata[];
  inputs: DateInputs;
}
