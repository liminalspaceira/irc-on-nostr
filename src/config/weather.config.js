// Weather API Configuration
// 
// To get real weather data, you need an OpenWeatherMap API key:
// 1. Go to https://openweathermap.org/api
// 2. Sign up for a free account
// 3. Get your API key from the dashboard
// 4. Replace 'YOUR_API_KEY_HERE' below with your actual API key
// 5. Set ENABLE_REAL_WEATHER to true

export const WEATHER_CONFIG = {
  // OpenWeatherMap API Key (get free key at https://openweathermap.org/api)
  API_KEY: 'YOUR_API_KEY_HERE',
  
  // Enable real weather data (set to true when you have an API key)
  ENABLE_REAL_WEATHER: false,
  
  // API Settings
  API_BASE_URL: 'https://api.openweathermap.org/data/2.5',
  
  // Cache settings
  CACHE_TIMEOUT_MINUTES: 10,
  
  // Default units (metric = Celsius, imperial = Fahrenheit)
  UNITS: 'metric'
};

// Instructions:
// 1. Get your free API key from OpenWeatherMap
// 2. Replace 'YOUR_API_KEY_HERE' with your actual key
// 3. Set ENABLE_REAL_WEATHER to true
// 4. Restart the app
//
// Example:
// API_KEY: 'abcd1234567890abcd1234567890abcd',
// ENABLE_REAL_WEATHER: true,

export default WEATHER_CONFIG;