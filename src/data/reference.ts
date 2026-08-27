import type { Network, DataPlan, TvProvider, TvPlan, Disco, ExamBody } from "../types";

// Static reference data (not user/transaction data). Networks, discos and exam
// bodies rarely change, so these are safe to hardcode. Live prices for data
// bundles / TV plans should ultimately come from VTpass's "Get Variation
// Codes" endpoint (see src/lib/vtpass.ts) rather than this static list — the
// entries below are placeholders to build the UI against.

export const NETWORKS: Network[] = [
  { id: "mtn", name: "MTN", color: "#FFCB05" },
  { id: "airtel", name: "Airtel", color: "#FF0000" },
  { id: "glo", name: "Glo", color: "#00A651" },
  { id: "9mobile", name: "9mobile", color: "#00A99D" },
];

export const DATA_PLANS: DataPlan[] = [
  { id: "mtn-1gb-30", network: "mtn", name: "1GB - 30 Days", size: "1GB", validity: "30 days", price: 800 },
  { id: "mtn-2gb-30", network: "mtn", name: "2GB - 30 Days", size: "2GB", validity: "30 days", price: 1500 },
  { id: "mtn-5gb-30", network: "mtn", name: "5GB - 30 Days", size: "5GB", validity: "30 days", price: 3500 },
  { id: "airtel-1gb-30", network: "airtel", name: "1GB - 30 Days", size: "1GB", validity: "30 days", price: 750 },
  { id: "airtel-2gb-30", network: "airtel", name: "2GB - 30 Days", size: "2GB", validity: "30 days", price: 1450 },
  { id: "glo-1.5gb-30", network: "glo", name: "1.5GB - 30 Days", size: "1.5GB", validity: "30 days", price: 700 },
  { id: "9mobile-1gb-30", network: "9mobile", name: "1GB - 30 Days", size: "1GB", validity: "30 days", price: 800 },
];

export const TV_PROVIDERS: TvProvider[] = [
  { id: "dstv", name: "DStv" },
  { id: "gotv", name: "GOtv" },
  { id: "startimes", name: "StarTimes" },
];

export const TV_PLANS: TvPlan[] = [
  { id: "dstv-padi", provider: "dstv", name: "DStv Padi", price: 3600 },
  { id: "dstv-yanga", provider: "dstv", name: "DStv Yanga", price: 5100 },
  { id: "dstv-compact", provider: "dstv", name: "DStv Compact", price: 19000 },
  { id: "gotv-smallie", provider: "gotv", name: "GOtv Smallie", price: 1900 },
  { id: "gotv-jinja", provider: "gotv", name: "GOtv Jinja", price: 3900 },
  { id: "startimes-nova", provider: "startimes", name: "StarTimes Nova", price: 1700 },
];

export const DISCOS: Disco[] = [
  { id: "ikeja", name: "IKEDC", fullName: "Ikeja Electric" },
  { id: "eko", name: "EKEDC", fullName: "Eko Electric" },
  { id: "abuja", name: "AEDC", fullName: "Abuja Electric" },
  { id: "kano", name: "KEDCO", fullName: "Kano Electric" },
  { id: "ph", name: "PHED", fullName: "Port Harcourt Electric" },
  { id: "ibadan", name: "IBEDC", fullName: "Ibadan Electric" },
];

export const EXAM_BODIES: ExamBody[] = [
  { id: "waec", name: "WAEC", fullName: "WAEC Result Checker PIN", price: 3400 },
  // NOTE: VTpass does not offer a NECO result-checker product (only WAEC
  // Registration/Result Checker and JAMB). Purchases for "neco" will return
  // a clear error from vtpass-purchase rather than silently hit the wrong
  // product. Remove this entry from the UI, or find an alternate provider
  // for NECO specifically, before going live.
  { id: "neco", name: "NECO", fullName: "NECO Result Checker PIN", price: 1300 },
];
