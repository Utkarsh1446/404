export const places = [
  {
    id: 'paris',
    city: 'Paris',
    country: 'France',
    lat: 48.8566,
    lng: 2.3522,
    image: 'paris.jpg',
  },
  {
    id: 'tokyo',
    city: 'Tokyo',
    country: 'Japan',
    lat: 35.6762,
    lng: 139.6503,
    image: 'tokyo.jpg',
  },
  {
    id: 'nyc',
    city: 'New York',
    country: 'United States',
    lat: 40.7128,
    lng: -74.006,
    image: 'nyc.jpg',
  },
  {
    id: 'sydney',
    city: 'Sydney',
    country: 'Australia',
    lat: -33.8688,
    lng: 151.2093,
    image: 'sydney.jpg',
  },
  {
    id: 'rio',
    city: 'Rio de Janeiro',
    country: 'Brazil',
    lat: -22.9068,
    lng: -43.1729,
    image: 'rio.jpg',
  },
  {
    id: 'cairo',
    city: 'Cairo',
    country: 'Egypt',
    lat: 30.0444,
    lng: 31.2357,
    image: 'cairo.jpg',
  },
]

export function placeById(id) {
  return places.find((place) => place.id === id) ?? null
}
