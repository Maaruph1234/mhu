import { supabase, extractFunctionErrorMessage } from "./supabaseClient";
import type { EsimOrder, EsimPackage, EsimRegion } from "../types";

/** Client-side wrapper around the payvessel-esim Edge Function. */

async function invoke<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("payvessel-esim", { body: payload });
  if (error) throw new Error(await extractFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export async function listRegions(): Promise<EsimRegion[]> {
  const { regions } = await invoke<{ regions: EsimRegion[] }>({ action: "regions" });
  return regions;
}

export async function listPackages(locationCode?: string): Promise<EsimPackage[]> {
  const { packages } = await invoke<{ packages: EsimPackage[] }>({ action: "packages", locationCode });
  return packages;
}

export async function createOrder(packageCode: string): Promise<EsimOrder> {
  const { order } = await invoke<{ order: EsimOrder }>({ action: "create", packageCode });
  return order;
}

export async function listOrders(): Promise<EsimOrder[]> {
  const { orders } = await invoke<{ orders: EsimOrder[] }>({ action: "list" });
  return orders;
}

export async function getOrder(orderId: string): Promise<Record<string, unknown>> {
  const { order } = await invoke<{ order: Record<string, unknown> }>({ action: "get", orderId });
  return order;
}
