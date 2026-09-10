import { useEffect, useState } from "react";
import { Plane, Plus, Trash2, ArrowRight, Clock, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { useAuth } from "../../context/AuthContext";
import * as flights from "../../lib/flights";
import type { FlightAirport, FlightOrder, FlightPassengerInput, FlightQuote, FlightSearchOption } from "../../types";

// Flight search + booking via Payvessel's VaaS Flight API. Supports
// one-way, round-trip, and multi-city itineraries; multiple
// adults/children/infants with per-passenger details; and all four cabin
// classes. The edge function (supabase/functions/payvessel-flight/index.ts)
// already forwards itineraries/passengers/cabinClass through to Payvessel
// as-is, so this UI expansion needed no backend changes.

type Step = "search" | "results" | "quote" | "done";
type TripType = "oneway" | "return" | "multidestination";
type CabinClass = "economy" | "premium_economy" | "business" | "first";

interface Leg {
  from: string;
  to: string;
  date: string;
}

const CABIN_LABELS: Record<CabinClass, string> = {
  economy: "Economy",
  premium_economy: "Premium Economy",
  business: "Business",
  first: "First Class",
};

function emptyLeg(): Leg {
  return { from: "", to: "", date: "" };
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface PassengerSlot {
  type: FlightPassengerInput["passenger_type"];
  label: string;
}

function buildPassengerSlots(adults: number, children: number, infants: number): PassengerSlot[] {
  const slots: PassengerSlot[] = [];
  for (let i = 0; i < adults; i++) slots.push({ type: "Adult", label: `Adult ${i + 1}` });
  for (let i = 0; i < children; i++) slots.push({ type: "Child", label: `Child ${i + 1}` });
  for (let i = 0; i < infants; i++) slots.push({ type: "Infant", label: `Infant ${i + 1}` });
  return slots;
}

export default function FlightBooking() {
  const { profile } = useAuth();
  const [airports, setAirports] = useState<FlightAirport[]>([]);
  const [step, setStep] = useState<Step>("search");
  const [tripType, setTripType] = useState<TripType>("oneway");
  const [legs, setLegs] = useState<Leg[]>([emptyLeg()]);
  const [cabinClass, setCabinClass] = useState<CabinClass>("economy");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [options, setOptions] = useState<FlightSearchOption[]>([]);
  const [quote, setQuote] = useState<FlightQuote | null>(null);
  const [passengers, setPassengers] = useState<{ firstName: string; lastName: string; dob: string }[]>([]);
  const [orders, setOrders] = useState<FlightOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingAirports, setLoadingAirports] = useState(true);
  const [airportsError, setAirportsError] = useState<string | null>(null);

  // Previously had no error handling at all -- if this call failed (network
  // blip, Payvessel's flight API down, etc.) the airport list just silently
  // stayed empty forever with nothing telling the user why the From/To
  // pickers had nothing in them. Now surfaces the real error and offers a
  // retry instead of a dead end.
  const loadAirports = () => {
    setLoadingAirports(true);
    setAirportsError(null);
    flights
      .listAirports()
      .then(setAirports)
      .catch((err) => setAirportsError((err as Error).message))
      .finally(() => setLoadingAirports(false));
  };

  useEffect(() => {
    loadAirports();
    flights.listOrders().then(setOrders);
  }, []);

  const airportOptions = airports.map((a) => ({ value: a.airport_code, label: `${a.city} (${a.airport_code})` }));

  // Trip type controls how many itinerary legs are editable.
  const setTrip = (t: TripType) => {
    setTripType(t);
    if (t === "oneway") setLegs([legs[0] ?? emptyLeg()]);
    else if (t === "return") setLegs([legs[0] ?? emptyLeg(), legs[1] ?? emptyLeg()]);
    else if (legs.length < 2) setLegs([legs[0] ?? emptyLeg(), emptyLeg()]);
  };

  const updateLeg = (i: number, patch: Partial<Leg>) => {
    setLegs((ls) => ls.map((l, li) => (li === i ? { ...l, ...patch } : l)));
  };

  const addLeg = () => setLegs((ls) => [...ls, emptyLeg()]);
  const removeLeg = (i: number) => setLegs((ls) => ls.filter((_, li) => li !== i));

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (legs.some((l) => !l.from || !l.to || !l.date)) {
      setError("Fill in every flight leg");
      return;
    }
    setLoading(true);
    try {
      const itineraries = legs.map((l) => ({
        departure_airport_code: l.from,
        arrival_airport_code: l.to,
        departure_date: l.date,
      }));
      const results = await flights.searchFlights({
        searchType: tripType,
        cabinClass,
        adults,
        children,
        infants,
        itineraries,
      });
      setOptions(results);
      setStep("results");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (option: FlightSearchOption) => {
    setError(null);
    setLoading(true);
    try {
      const q = await flights.createQuote(option.selection_token);
      setQuote(q);
      const slots = buildPassengerSlots(adults, children, infants);
      setPassengers(
        slots.map((s, i) =>
          i === 0 && s.type === "Adult" && profile?.display_name
            ? { firstName: profile.display_name.split(" ")[0] ?? "", lastName: profile.display_name.split(" ").slice(1).join(" "), dob: "" }
            : { firstName: "", lastName: "", dob: "" }
        )
      );
      setStep("quote");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const slots = buildPassengerSlots(adults, children, infants);

  const handleBook = async () => {
    if (!quote) return;
    setError(null);
    const missing = passengers.some((p) => !p.firstName || !p.lastName);
    if (missing) {
      setError("Enter every passenger's full name");
      return;
    }
    setLoading(true);
    try {
      const passengerInputs: FlightPassengerInput[] = passengers.map((p, i) => ({
        passenger_type: slots[i].type,
        first_name: p.firstName,
        last_name: p.lastName,
        date_of_birth: p.dob || undefined,
        email: i === 0 ? profile?.email ?? undefined : undefined,
        phone_number: i === 0 ? profile?.phone_number ?? undefined : undefined,
      }));
      const order = await flights.createOrder(quote.id, passengerInputs);
      setOrders((o) => [order, ...o]);
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const resetSearch = () => {
    setStep("search");
    setOptions([]);
    setQuote(null);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Book a flight</h1>
        <p className="mt-1 text-sm text-slate-500">Search, confirm pricing, and book straight from your wallet.</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}

      {step === "search" && (
        <Card>
          <form onSubmit={handleSearch} className="space-y-5">
            <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
              {([
                ["oneway", "One way"],
                ["return", "Round trip"],
                ["multidestination", "Multi-city"],
              ] as [TripType, string][]).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTrip(t)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                    tripType === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {loadingAirports && <p className="text-sm text-slate-500">Loading airports…</p>}
            {airportsError && !loadingAirports && (
              <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500">
                <span>Couldn't load airports: {airportsError}</span>
                <button type="button" onClick={loadAirports} className="font-medium text-accent hover:underline">
                  Retry
                </button>
              </div>
            )}
            <div className="space-y-3">
              {legs.map((leg, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3">
                  {tripType === "multidestination" && (
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Flight {i + 1}
                      </span>
                      {legs.length > 2 && (
                        <button type="button" onClick={() => removeLeg(i)} className="text-slate-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <SearchableSelect
                      label="From"
                      value={leg.from}
                      onChange={(v) => updateLeg(i, { from: v })}
                      options={airportOptions}
                      loading={loadingAirports}
                      disabled={!airports.length}
                      placeholder={airports.length ? "Select" : "Unavailable"}
                    />
                    <SearchableSelect
                      label="To"
                      value={leg.to}
                      onChange={(v) => updateLeg(i, { to: v })}
                      options={airportOptions}
                      loading={loadingAirports}
                      disabled={!airports.length}
                      placeholder={airports.length ? "Select" : "Unavailable"}
                    />
                  </div>
                  <Input
                    label="Departure date"
                    type="date"
                    className="mt-3"
                    value={leg.date}
                    onChange={(e) => updateLeg(i, { date: e.target.value })}
                  />
                </div>
              ))}
              {tripType === "multidestination" && legs.length < 5 && (
                <button
                  type="button"
                  onClick={addLeg}
                  className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                >
                  <Plus size={14} /> Add another flight
                </button>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-600">Cabin class</p>
              <select
                value={cabinClass}
                onChange={(e) => setCabinClass(e.target.value as CabinClass)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
              >
                {(Object.keys(CABIN_LABELS) as CabinClass[]).map((c) => (
                  <option key={c} value={c}>
                    {CABIN_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Input label="Adults" type="number" min={1} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value)))} />
              <Input label="Children" type="number" min={0} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value)))} />
              <Input label="Infants" type="number" min={0} value={infants} onChange={(e) => setInfants(Math.max(0, Number(e.target.value)))} />
            </div>

            <Button type="submit" fullWidth loading={loading} icon={<Plane size={16} />}>
              Search flights
            </Button>
          </form>
        </Card>
      )}

      {step === "results" && (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" onClick={resetSearch}>
            ← New search
          </Button>
          {!options.length && (
            <Card className="text-center text-sm text-slate-500">No flights found for that route/date.</Card>
          )}
          {options.map((o, i) => (
            <Card key={i} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {o.airline_logo_url && (
                    <img src={o.airline_logo_url} alt="" className="h-6 w-6 rounded object-contain" />
                  )}
                  <p className="font-semibold text-slate-900">{o.airline_name ?? "Airline"}</p>
                  {o.is_refundable && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                      Refundable
                    </span>
                  )}
                </div>
                <p className="text-lg font-bold text-slate-900">
                  {o.pricing.currency_code} {o.pricing.total_amount.toLocaleString()}
                </p>
              </div>
              <div className="space-y-2">
                {o.journeys.map((j, ji) => (
                  <div key={ji} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex items-center gap-1.5 font-medium text-slate-900">
                      <span>{j.departure_airport_code}</span>
                      <ArrowRight size={12} className="text-slate-400" />
                      <span>{j.arrival_airport_code}</span>
                    </div>
                    <span className="text-slate-400">·</span>
                    <span className="flex items-center gap-1 text-slate-500">
                      <Clock size={12} /> {j.trip_duration ?? ""}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">{j.stop_count ? `${j.stop_count} stop(s)` : "Nonstop"}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {formatDateTime(j.departure_datetime)}
                      {j.arrival_datetime ? ` → ${formatDateTime(j.arrival_datetime)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <Button size="sm" fullWidth loading={loading} onClick={() => handleSelect(o)}>
                Select
              </Button>
            </Card>
          ))}
        </div>
      )}

      {step === "quote" && quote && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm your booking</CardTitle>
          </CardHeader>
          <div className="mb-5 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex items-center gap-2">
              {quote.airlineLogoUrl && <img src={quote.airlineLogoUrl} alt="" className="h-5 w-5 rounded object-contain" />}
              <p className="font-medium text-slate-900">{quote.airlineName}</p>
            </div>
            {quote.journeys.map((j, i) => (
              <p key={i} className="text-slate-500">
                {j.departure_airport_code} → {j.arrival_airport_code}
                {j.departure_datetime ? ` · ${formatDateTime(j.departure_datetime)}` : ""}
              </p>
            ))}
            <p className="pt-2 text-lg font-bold text-slate-900">₦{quote.amountNgn.toLocaleString()}</p>
            <p className="text-xs text-slate-400">Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}</p>
          </div>

          <div className="space-y-4">
            {slots.map((slot, i) => (
              <div key={i}>
                <p className="mb-2 text-sm font-semibold text-slate-700">{slot.label}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="First name"
                    value={passengers[i]?.firstName ?? ""}
                    onChange={(e) =>
                      setPassengers((p) => p.map((x, xi) => (xi === i ? { ...x, firstName: e.target.value } : x)))
                    }
                  />
                  <Input
                    label="Last name"
                    value={passengers[i]?.lastName ?? ""}
                    onChange={(e) =>
                      setPassengers((p) => p.map((x, xi) => (xi === i ? { ...x, lastName: e.target.value } : x)))
                    }
                  />
                </div>
                <Input
                  label={slot.type === "Adult" ? "Date of birth (optional)" : "Date of birth"}
                  type="date"
                  className="mt-3"
                  value={passengers[i]?.dob ?? ""}
                  onChange={(e) => setPassengers((p) => p.map((x, xi) => (xi === i ? { ...x, dob: e.target.value } : x)))}
                />
              </div>
            ))}
          </div>

          <Button fullWidth className="mt-5" loading={loading} onClick={handleBook}>
            Confirm & book
          </Button>
        </Card>
      )}

      {step === "done" && (
        <Card className="text-center">
          <CheckCircle2 className="mx-auto mb-2 text-emerald-500" size={40} />
          <p className="text-lg font-semibold text-slate-900">Booking submitted</p>
          <p className="mt-1 text-sm text-slate-500">Track its status below under "My bookings".</p>
          <Button className="mt-4" onClick={resetSearch}>
            Book another flight
          </Button>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>My bookings</CardTitle>
        </CardHeader>
        {!orders.length && <p className="text-sm text-slate-500">No flight bookings yet.</p>}
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{o.route_summary}</p>
                <p className="text-xs text-slate-500">₦{o.amount_ngn.toLocaleString()} · {o.status}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
