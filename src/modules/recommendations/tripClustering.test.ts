import { clusterLogsForTripSuggestions, clusterSignature, ClusterableLog } from './tripClustering';

const LISBON = { lat: 38.7223, lng: -9.1393 };
const PORTO = { lat: 41.1579, lng: -8.6291 }; // ~275km from Lisbon, well outside 50km

function log(placeId: string, hoursFromEpoch: number, coords = LISBON): ClusterableLog {
  return { placeId, lat: coords.lat, lng: coords.lng, loggedAt: new Date(hoursFromEpoch * 60 * 60 * 1000) };
}

describe('clusterLogsForTripSuggestions', () => {
  it('drops a single isolated log (not a trip)', () => {
    const clusters = clusterLogsForTripSuggestions([log('p1', 0)]);
    expect(clusters).toEqual([]);
  });

  it('groups two logs within 72h and 50km into one cluster', () => {
    const clusters = clusterLogsForTripSuggestions([log('p1', 0), log('p2', 10)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].placeIds).toEqual(['p1', 'p2']);
  });

  it('splits logs more than 72h apart into separate clusters', () => {
    const clusters = clusterLogsForTripSuggestions([log('p1', 0), log('p2', 10), log('p3', 200), log('p4', 210)]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].placeIds).toEqual(['p1', 'p2']);
    expect(clusters[1].placeIds).toEqual(['p3', 'p4']);
  });

  it('splits logs more than 50km apart even within the time window', () => {
    const clusters = clusterLogsForTripSuggestions([log('p1', 0), log('p2', 5, PORTO), log('p3', 10, PORTO)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].placeIds).toEqual(['p2', 'p3']);
  });

  it('handles an odd-sized cluster (5 logs, one trip)', () => {
    const logs = [log('p1', 0), log('p2', 10), log('p3', 20), log('p4', 30), log('p5', 40)];
    const clusters = clusterLogsForTripSuggestions(logs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].placeIds).toHaveLength(5);
  });

  it('handles an even-sized cluster (4 logs, one trip)', () => {
    const logs = [log('p1', 0), log('p2', 10), log('p3', 20), log('p4', 30)];
    const clusters = clusterLogsForTripSuggestions(logs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].placeIds).toHaveLength(4);
  });

  it('sets start/end date to the min/max logged_at in the cluster', () => {
    const clusters = clusterLogsForTripSuggestions([log('p1', 0), log('p2', 10), log('p3', 20)]);
    expect(clusters[0].startDate).toEqual(new Date(0));
    expect(clusters[0].endDate).toEqual(new Date(20 * 60 * 60 * 1000));
  });

  it('sorts input by time regardless of input order', () => {
    const clusters = clusterLogsForTripSuggestions([log('p2', 10), log('p1', 0)]);
    expect(clusters[0].placeIds).toEqual(['p1', 'p2']);
  });
});

describe('clusterSignature', () => {
  it('is stable regardless of input order', () => {
    expect(clusterSignature(['b', 'a'])).toBe(clusterSignature(['a', 'b']));
  });

  it('changes when membership changes', () => {
    expect(clusterSignature(['a', 'b'])).not.toBe(clusterSignature(['a', 'b', 'c']));
  });
});
