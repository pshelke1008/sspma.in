import { useQuery } from '@tanstack/react-query';
import { api, buildQuery } from '@/lib/api/client';

export interface LocationOption {
  value: string;
  count: number;
}

export interface DonorLocations {
  states: LocationOption[];
  districts: LocationOption[];
  villages: LocationOption[];
}

/**
 * States, districts and villages already recorded on donors. Districts are
 * narrowed to `state` and villages to `district`, so each list stays short.
 */
export function useDonorLocations(scope: { state?: string; district?: string }, enabled = true) {
  const params = { state: scope.state || undefined, district: scope.district || undefined };
  return useQuery({
    queryKey: ['donors', 'locations', params],
    queryFn: () => api.get<{ data: DonorLocations }>('/donors/locations' + buildQuery(params)).then((result) => result.data),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    enabled,
  });
}

/** "Wai, Satara, Maharashtra" — the parts that are filled in, smallest first. */
export function formatPlace(donor: { village?: string | null; district?: string | null; state?: string | null }, withState = false) {
  return [donor.village, donor.district, withState ? donor.state : null].filter(Boolean).join(', ');
}
