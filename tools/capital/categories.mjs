// OSM tag → viewer category. Order matters: first match wins. `singular` labels unnamed features.
export const CATEGORIES = [
  {id: 'fuel', label: 'Petrol pumps', singular: 'Petrol pump', match: t => t.amenity === 'fuel' || t.amenity === 'charging_station'},
  {id: 'hospital', label: 'Hospitals & clinics', singular: 'Clinic', match: t => ['hospital', 'clinic', 'doctors', 'dentist', 'blood_bank'].includes(t.amenity) || ['hospital', 'clinic', 'doctor', 'dentist'].includes(t.healthcare) || t.building === 'hospital'},
  {id: 'pharmacy', label: 'Pharmacies', singular: 'Pharmacy', match: t => t.amenity === 'pharmacy' || t.healthcare === 'pharmacy' || t.shop === 'chemist'},
  {id: 'college', label: 'Colleges & universities', singular: 'College', match: t => ['college', 'university'].includes(t.amenity) || ['college', 'university'].includes(t.building) || t.office === 'educational_institution'},
  {id: 'school', label: 'Schools', singular: 'School', match: t => ['school', 'kindergarten'].includes(t.amenity) || ['school', 'kindergarten'].includes(t.building)},
  {id: 'mall', label: 'Malls & markets', singular: 'Market', match: t => ['mall', 'department_store', 'supermarket'].includes(t.shop) || t.amenity === 'marketplace' || t.building === 'retail' && !!t.name},
  {id: 'bank', label: 'Banks & ATMs', singular: 'ATM', match: t => ['bank', 'atm', 'bureau_de_change'].includes(t.amenity)},
  {id: 'worship', label: 'Temples & places of worship', singular: 'Place of worship', match: t => t.amenity === 'place_of_worship' || ['temple', 'mosque', 'church'].includes(t.building)},
  {id: 'government', label: 'Government offices', singular: 'Government office', match: t => t.office === 'government' || t.building === 'government' || t.amenity === 'townhall' || t.amenity === 'courthouse'},
  {id: 'food', label: 'Food & cafés', singular: 'Eatery', match: t => ['restaurant', 'cafe', 'fast_food', 'ice_cream', 'food_court'].includes(t.amenity) || t.shop === 'bakery'},
  {id: 'hotel', label: 'Hotels & stays', singular: 'Hotel', match: t => ['hotel', 'guest_house', 'hostel', 'motel'].includes(t.tourism)},
  {id: 'metro', label: 'Metro stations', singular: 'Metro station', match: t => t.railway === 'station' && (t.station === 'subway' || t.subway === 'yes' || t.station === 'light_rail')},
  {id: 'rail', label: 'Railway stations', singular: 'Railway station', match: t => ['station', 'halt'].includes(t.railway) || t.building === 'train_station'},
  {id: 'bus', label: 'Bus stands & stops', singular: 'Bus stop', match: t => t.amenity === 'bus_station' || t.highway === 'bus_stop' || t.building === 'bus_station'},
  {id: 'airport', label: 'Airports & helipads', singular: 'Helipad', match: t => ['aerodrome', 'terminal', 'helipad', 'heliport'].includes(t.aeroway)},
  {id: 'park', label: 'Parks & sport', singular: 'Park', match: t => ['park', 'garden', 'stadium', 'sports_centre', 'playground'].includes(t.leisure)},
  {id: 'attraction', label: 'Attractions', singular: 'Attraction', match: t => ['attraction', 'museum', 'viewpoint', 'artwork', 'zoo', 'theme_park'].includes(t.tourism) || t.amenity === 'theatre' || t.amenity === 'cinema'},
];
export function categoryOf(tags = {}) {
  return CATEGORIES.find(c => c.match(tags))?.id || null;
}
