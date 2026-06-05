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

export namespace BookingMapLib {
  export interface BookingStructOutput {
    status: bigint;
    year: number | bigint;
    dayOfYear: number | bigint;
    price: bigint;
    timestamp: bigint;
  }

  export type BookingStruct = BookingStructOutput;

  export interface YearStruct {
    number: number;
    leapYear: boolean;
    start: number;
    end: number;
    enabled: boolean;
  }
}
