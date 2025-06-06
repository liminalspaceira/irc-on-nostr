# Weather API Setup Guide

The IRC on Nostr app includes a WeatherBot that can provide real weather data using the OpenWeatherMap API.

## Current Status
🎲 **Currently using simulated weather data** - Follow the steps below to enable real weather data.

## How to Enable Real Weather Data

### Step 1: Get an OpenWeatherMap API Key (Free)

1. Go to [OpenWeatherMap API](https://openweathermap.org/api)
2. Click "Sign Up" to create a free account
3. After signing up, go to your dashboard
4. Navigate to the "API Keys" section
5. Copy your default API key (or create a new one)

### Step 2: Configure the WeatherBot

1. Open the file: `src/config/weather.config.js`
2. Replace `'YOUR_API_KEY_HERE'` with your actual API key
3. Set `ENABLE_REAL_WEATHER` to `true`

Example configuration:
```javascript
export const WEATHER_CONFIG = {
  API_KEY: 'abcd1234567890abcd1234567890abcd', // Your actual API key
  ENABLE_REAL_WEATHER: true, // Changed to true
  // ... other settings
};
```

### Step 3: Restart the App

After making the changes, restart your application. You should see in the console:
```
🌤️ WeatherBot: Real weather data enabled
```

## Testing Real Weather Data

Try these commands in any channel:
- `!weather New York` - Get current weather for New York
- `!weather London, UK` - Get weather for London
- `!weather Tokyo` - Get weather for Tokyo
- `!forecast Paris` - Get 3-day forecast for Paris

## Features with Real Weather Data

When using real weather data, you'll get:

### Current Weather (`!weather <location>`)
- ✅ Real temperature and conditions
- ✅ Humidity and atmospheric pressure
- ✅ Wind speed and direction
- ✅ Visibility and cloudiness
- ✅ Accurate location names with country codes
- ✅ Proper weather icons

### Weather Forecast (`!forecast <location>`)
- ✅ 3-day forecast with real data
- ✅ High and low temperatures
- ✅ Weather conditions for each day

### Additional Features
- 🕒 **10-minute caching** - Reduces API calls and improves performance
- 🌐 **Global coverage** - Works for cities worldwide
- 🎯 **Smart fallback** - If API fails, shows simulated data with error message
- 📍 **Location validation** - Clear error messages for unknown locations

## API Limits

The free OpenWeatherMap plan includes:
- ✅ 1,000 API calls per day
- ✅ Current weather data
- ✅ 5-day forecast data
- ✅ No credit card required

This is more than enough for typical bot usage with caching enabled.

## Troubleshooting

### "Weather API key is invalid" Error
- Double-check your API key in `weather.config.js`
- Make sure you copied the entire key correctly
- Ensure your OpenWeatherMap account is activated

### "Location not found" Error
- Try different variations of the city name
- Include country code: "London, UK" or "Paris, FR"
- Use major city names when possible

### Still Showing Simulated Data
- Verify `ENABLE_REAL_WEATHER` is set to `true`
- Check that `API_KEY` is not `'YOUR_API_KEY_HERE'`
- Restart the application after making changes
- Check console for configuration messages

## Example Response

With real weather data enabled, `!weather New York` might return:
```
🌤️ Weather for New York, US 🌐

☀️ Clear
*clear sky*

🌡️ Temperature: 22°C
🤚 Feels like: 24°C
💧 Humidity: 65%
📊 Pressure: 1013 hPa
💨 Wind: 8 km/h (SW)
👁️ Visibility: 10 km
☁️ Cloudiness: 0%

📅 Updated: 2:30:45 PM
```

The 🌐 emoji indicates real data, while 🎲 indicates simulated data.

## Security Note

⚠️ **Keep your API key secure:**
- Don't commit your API key to public repositories
- Consider using environment variables for production deployments
- The free tier API key has built-in rate limiting for protection

## Need Help?

If you encounter issues:
1. Check the browser console for error messages
2. Verify your API key works by testing it directly at OpenWeatherMap
3. Make sure the configuration file syntax is correct
4. Try with simple city names first (e.g., "London" before "London, UK")

Happy weather checking! 🌤️