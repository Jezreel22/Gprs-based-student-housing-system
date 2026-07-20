/**
 * Shared TypeScript types for the Maps module.
 * Mirrors the NearbyProperty shape returned by GET /api/properties/nearby.
 */

export interface NearbyPropertyLandlord {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  verification_status: string | null;
  average_rating: number | null;
}

export interface NearbyProperty {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  rent_amount_ngn: number;
  deposit_amount_ngn: number;
  rooms: number;
  listing_status: string;
  amenities: Record<string, boolean>;
  hero_photo_url: string | null;
  created_at: string | null;
  trust_score: number;
  distance_from_centre_km: number;
  distance_from_naub_km: number;
  landlord: NearbyPropertyLandlord | null;
}

export interface NearbyPropertiesResponse {
  data: NearbyProperty[];
  total: number;
  page: number;
  page_size: number;
}

export interface MapFilters {
  radius_km: number;
  rent_min: number | undefined;
  rent_max: number | undefined;
  rooms: number | undefined;
  trust_score_min: number | undefined;
  verified_only: boolean;
}

export interface MapCentre {
  lat: number;
  lng: number;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}
