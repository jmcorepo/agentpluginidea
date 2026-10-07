export interface AddressSuggestion {id:string;label:string;latitude:number;longitude:number}
export interface AddressSearchResult {suggestions:AddressSuggestion[];attribution:string}
export type AddressFetcher=(url:string,options:{headers:Record<string,string>;signal:AbortSignal})=>Promise<{ok:boolean;json:()=>Promise<unknown>}>;
export const addressAttribution:string;
export function normalizeAddressResults(data:unknown):AddressSuggestion[];
export function createAddressSearch(fetcher?:AddressFetcher):(query:string)=>Promise<AddressSearchResult>;
