import {TDFToken, TDFDiamond} from '../../../typechain';

export type DateInputs = [number, number][];
interface setUser {
  address: string;
  TDFToken: TDFToken;
  TDFDiamond: TDFDiamond;
}
export interface DateMetadata {
  year: number;
  day: number;
  unix: number;
}
export interface DatesTestData {
  data: DateMetadata[];
  inputs: DateInputs;
}

export interface HelpersInput {
  diamond: TDFDiamond;
  tokenContract: TDFToken;
  user: setUser;
  admin: setUser;
}
