import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import type { FlightAirport, FlightOrder, FlightPassengerInput, FlightQuote, FlightSearchOption } from "../types";

/** Client-side wrapper around the payvessel-flight Edge Function. */

async function invoke<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("payvessel-flight", { body: payload });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export async function listAirports(): Promise<FlightAirport[]> {
  const { airports } = await invoke<{ airports: FlightAirport[] }>({ action: "airports" });
  return airports;
}

export interface SearchInput {
  searchType: "oneway" | "return" | "multidestination";
  cabinClass: "economy" | "premium_economy" | "business" | "first";
  adults: number;
  children?: number;
  infants?: number;
  itineraries: Array<{ departure_airport_code: string; arrival_airport_code: string; departure_date: string }>;
}

export async function searchFlights(input: SearchInput): Promise<FlightSearchOption[]> {
  const { options } = await invoke<{ options: FlightSearchOption[] }>({ action: "search", ...input });
  return options;
}

export async function createQuote(selectionToken: string): Promise<FlightQuote> {
  const { quote } = await invoke<{ quote: FlightQuote }>({ action: "quote", selectionToken });
  return quote;
}

export async function createOrder(quoteId: string, passengers: FlightPassengerInput[]): Promise<FlightOrder> {
  const { order } = await invoke<{ order: FlightOrder }>({ action: "createOrder", quoteId, passengers });
  return order;
}

export async function listOrders(): Promise<FlightOrder[]> {
  const { orders } = await invoke<{ orders: FlightOrder[] }>({ action: "list" });
  return orders;
}

export async function getOrder(orderId: string): Promise<Record<string, unknown>> {
  const { order } = await invoke<{ order: Record<string, unknown> }>({ action: "get", orderId });
  return order;
}
