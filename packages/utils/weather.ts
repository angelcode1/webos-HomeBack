export type WeatherCondition =
	| 'clear'
	| 'partly-cloudy'
	| 'cloudy'
	| 'rain'
	| 'heavy-rain'
	| 'storm'
	| 'snow'
	| 'fog'
	| 'unknown';

export type WeatherSource = 'webos-weather' | 'webos-location-openmeteo';

export type WeatherSnapshot = {
	temperatureC: number;
	condition: WeatherCondition;
	observedAt: number;
	location?: string;
	source: WeatherSource;
	stale?: boolean;
};
