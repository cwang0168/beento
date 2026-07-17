import { config } from '../../config';
import { searchGooglePlaces } from './googlePlaces.client';

describe('searchGooglePlaces', () => {
  const originalKey = config.googlePlacesApiKey;
  const originalFetch = global.fetch;

  afterEach(() => {
    config.googlePlacesApiKey = originalKey;
    global.fetch = originalFetch;
  });

  it('returns no results when GOOGLE_PLACES_API_KEY is unset', async () => {
    config.googlePlacesApiKey = undefined;
    global.fetch = jest.fn();

    const results = await searchGooglePlaces('coffee');

    expect(results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps a text search response into GooglePlaceResult, defaulting unknown types to activity', async () => {
    config.googlePlacesApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            id: 'ChIJ-restaurant',
            displayName: { text: 'Time Out Market' },
            location: { latitude: 38.7, longitude: -9.1 },
            types: ['restaurant', 'point_of_interest'],
          },
          {
            id: 'ChIJ-landmark',
            displayName: { text: 'Belem Tower' },
            location: { latitude: 38.69, longitude: -9.21 },
            types: ['tourist_attraction'],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const results = await searchGooglePlaces('lisbon', { lat: 38.7, lng: -9.1 });

    expect(results).toEqual([
      { externalId: 'ChIJ-restaurant', name: 'Time Out Market', category: 'restaurant', lat: 38.7, lng: -9.1 },
      { externalId: 'ChIJ-landmark', name: 'Belem Tower', category: 'activity', lat: 38.69, lng: -9.21 },
    ]);

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
    const sentBody = JSON.parse(requestInit.body);
    expect(sentBody.locationBias.circle.center).toEqual({ latitude: 38.7, longitude: -9.1 });
  });

  it('returns no results when the provider responds with a non-ok status', async () => {
    config.googlePlacesApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const results = await searchGooglePlaces('coffee');

    expect(results).toEqual([]);
  });

  it('returns no results when the fetch itself throws', async () => {
    config.googlePlacesApiKey = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const results = await searchGooglePlaces('coffee');

    expect(results).toEqual([]);
  });
});
