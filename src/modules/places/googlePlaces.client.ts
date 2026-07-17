import { config } from '../../config';
import { PlaceCategoryValue } from '../../shared/categories';

export interface GooglePlaceResult {
  externalId: string;
  name: string;
  category: PlaceCategoryValue;
  lat: number;
  lng: number;
}

// Google Places (New) type taxonomy has ~200 values; this maps the common
// ones into our 4-category model. Unmapped/unknown types fall back to
// 'activity', the broadest bucket, rather than guessing wrong.
const TYPE_TO_CATEGORY: Record<string, PlaceCategoryValue> = {
  restaurant: 'restaurant',
  food: 'restaurant',
  cafe: 'restaurant',
  bakery: 'restaurant',
  meal_takeaway: 'restaurant',
  meal_delivery: 'restaurant',
  lodging: 'hotel',
  hotel: 'hotel',
  motel: 'hotel',
  resort_hotel: 'hotel',
  bar: 'bar',
  night_club: 'bar',
  pub: 'bar',
  wine_bar: 'bar',
};

function categoryFromTypes(types: string[]): PlaceCategoryValue {
  for (const type of types) {
    const mapped = TYPE_TO_CATEGORY[type];
    if (mapped) {
      return mapped;
    }
  }
  return 'activity';
}

interface TextSearchResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    location?: { latitude: number; longitude: number };
    types?: string[];
  }>;
}

// Inert (returns no results) when GOOGLE_PLACES_API_KEY is unset, e.g.
// local dev without a Google Cloud project configured -- callers fall back
// to local-DB-only search, same pattern as Sentry being a no-op without a DSN.
export async function searchGooglePlaces(
  query: string,
  near?: { lat: number; lng: number },
): Promise<GooglePlaceResult[]> {
  if (!config.googlePlacesApiKey) {
    return [];
  }

  const body: Record<string, unknown> = { textQuery: query };
  if (near) {
    body.locationBias = {
      circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 20000 },
    };
  }

  let response: Response;
  try {
    response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.googlePlacesApiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.types',
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Network hiccup talking to the provider shouldn't break search --
    // callers just get local-DB-only results for this request.
    return [];
  }

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as TextSearchResponse;
  return (data.places ?? [])
    .filter((place) => place.displayName?.text && place.location)
    .map((place) => ({
      externalId: place.id,
      name: place.displayName!.text,
      category: categoryFromTypes(place.types ?? []),
      lat: place.location!.latitude,
      lng: place.location!.longitude,
    }));
}
