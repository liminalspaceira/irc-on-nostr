import { BaseBot } from './BotFramework';
import { BOT_RESPONSE_TYPES } from '../utils/constants';
import { WEATHER_CONFIG } from '../config/weather.config';

export class WeatherBot extends BaseBot {
  constructor() {
    super('weather-bot', 'WeatherBot', 'Provides weather information for locations worldwide');
    
    // Add supported commands
    this.addCommand('weather', 'Get current weather for a location (e.g., !weather New York)');
    this.addCommand('forecast', 'Get weather forecast for a location (e.g., !forecast London)');
    
    // Cache for weather data
    this.weatherCache = new Map();
    this.cacheTimeout = WEATHER_CONFIG.CACHE_TIMEOUT_MINUTES * 60 * 1000;
    
    // OpenWeatherMap API configuration
    this.apiKey = WEATHER_CONFIG.API_KEY;
    this.apiBaseUrl = WEATHER_CONFIG.API_BASE_URL;
    this.useRealAPI = WEATHER_CONFIG.ENABLE_REAL_WEATHER && WEATHER_CONFIG.API_KEY !== 'YOUR_API_KEY_HERE';
    
    // Log configuration status
    if (this.useRealAPI) {
      console.log('🌤️ WeatherBot: Real weather data enabled');
    } else {
      console.log('🎲 WeatherBot: Using simulated weather data (configure API key for real data)');
    }
  }

  async executeCommand(command, args, context) {
    switch (command) {
      case 'weather':
        return await this.getCurrentWeather(args, context);
      
      case 'forecast':
        return await this.getWeatherForecast(args, context);
      
      default:
        return this.createErrorResponse(`Unknown command: ${command}`);
    }
  }

  async getCurrentWeather(args, context) {
    try {
      if (args.length === 0) {
        return this.createErrorResponse('Please specify a location. Example: !weather New York');
      }

      const location = args.join(' ');
      const cacheKey = `weather_${location.toLowerCase()}`;
      
      // Check cache first
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return this.formatWeatherResponse(cached, location, true);
      }

      // For demo purposes, we'll simulate weather data
      // In a real implementation, you'd call a weather API like OpenWeatherMap
      const weatherData = await this.fetchWeatherData(location);
      
      // Cache the result
      this.setCache(cacheKey, weatherData);
      
      return this.formatWeatherResponse(weatherData, location, false);

    } catch (error) {
      console.error('Error getting weather:', error);
      return this.createErrorResponse(`Failed to get weather for ${args.join(' ')}`);
    }
  }

  async getWeatherForecast(args, context) {
    try {
      if (args.length === 0) {
        return this.createErrorResponse('Please specify a location. Example: !forecast London');
      }

      const location = args.join(' ');
      const cacheKey = `forecast_${location.toLowerCase()}`;
      
      // Check cache first
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return this.formatForecastResponse(cached, location, true);
      }

      // For demo purposes, we'll simulate forecast data
      const forecastData = await this.fetchForecastData(location);
      
      // Cache the result
      this.setCache(cacheKey, forecastData);
      
      return this.formatForecastResponse(forecastData, location, false);

    } catch (error) {
      console.error('Error getting forecast:', error);
      return this.createErrorResponse(`Failed to get forecast for ${args.join(' ')}`);
    }
  }

  // Fetch weather data from OpenWeatherMap API or simulate if no API key
  async fetchWeatherData(location) {
    if (this.useRealAPI && this.apiKey !== 'YOUR_API_KEY_HERE') {
      return await this.fetchRealWeatherData(location);
    } else {
      return await this.fetchSimulatedWeatherData(location);
    }
  }

  // Fetch real weather data from OpenWeatherMap API
  async fetchRealWeatherData(location) {
    try {
      const url = `${this.apiBaseUrl}/weather?q=${encodeURIComponent(location)}&appid=${this.apiKey}&units=metric`;
      console.log(`Fetching weather data from: ${url.replace(this.apiKey, 'API_KEY')}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Location "${location}" not found. Please check the spelling.`);
        } else if (response.status === 401) {
          throw new Error('Weather API key is invalid. Please check configuration.');
        } else {
          throw new Error(`Weather API error: ${response.status}`);
        }
      }
      
      const data = await response.json();
      
      return {
        location: `${data.name}${data.sys.country ? ', ' + data.sys.country : ''}`,
        condition: data.weather[0].main,
        description: data.weather[0].description,
        temperature: Math.round(data.main.temp),
        feelsLike: Math.round(data.main.feels_like),
        humidity: data.main.humidity,
        pressure: data.main.pressure,
        windSpeed: Math.round(data.wind?.speed * 3.6) || 0, // m/s to km/h
        windDirection: data.wind?.deg || 0,
        visibility: data.visibility ? Math.round(data.visibility / 1000) : null, // meters to km
        cloudiness: data.clouds?.all || 0,
        sunrise: data.sys.sunrise,
        sunset: data.sys.sunset,
        timestamp: Date.now(),
        icon: this.getWeatherIcon(data.weather[0].main),
        isRealData: true
      };
      
    } catch (error) {
      console.error('Error fetching real weather data:', error);
      
      // Fall back to simulated data with error message
      const simulatedData = await this.fetchSimulatedWeatherData(location);
      simulatedData.error = error.message;
      return simulatedData;
    }
  }

  // Simulate weather data (fallback when no API key)
  async fetchSimulatedWeatherData(location) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Return simulated weather data
    const conditions = ['Clear', 'Clouds', 'Rain', 'Snow', 'Thunderstorm', 'Drizzle', 'Mist'];
    const descriptions = {
      'Clear': 'clear sky',
      'Clouds': 'scattered clouds',
      'Rain': 'light rain',
      'Snow': 'light snow',
      'Thunderstorm': 'thunderstorm',
      'Drizzle': 'light drizzle',
      'Mist': 'mist'
    };
    
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temp = Math.floor(Math.random() * 40) - 10; // -10 to 30°C
    const humidity = Math.floor(Math.random() * 60) + 30; // 30-90%
    const windSpeed = Math.floor(Math.random() * 20) + 5; // 5-25 km/h
    
    return {
      location: location,
      condition: condition,
      description: descriptions[condition],
      temperature: temp,
      feelsLike: temp + Math.floor(Math.random() * 6) - 3,
      humidity: humidity,
      pressure: Math.floor(Math.random() * 50) + 1000, // 1000-1050 hPa
      windSpeed: windSpeed,
      windDirection: Math.floor(Math.random() * 360),
      visibility: Math.floor(Math.random() * 10) + 5, // 5-15 km
      cloudiness: Math.floor(Math.random() * 100),
      timestamp: Date.now(),
      icon: this.getWeatherIcon(condition),
      isRealData: false
    };
  }

  // Simulate forecast API call
  async fetchForecastData(location) {
    await new Promise(resolve => setTimeout(resolve, 700));
    
    const days = ['Today', 'Tomorrow', 'Day 3'];
    const conditions = ['Sunny', 'Cloudy', 'Rainy', 'Partly Cloudy'];
    
    const forecast = days.map(day => ({
      day,
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      high: Math.floor(Math.random() * 30) + 10,
      low: Math.floor(Math.random() * 15) + 5,
      icon: this.getWeatherIcon(conditions[Math.floor(Math.random() * conditions.length)])
    }));

    return {
      location,
      forecast,
      timestamp: Date.now()
    };
  }

  formatWeatherResponse(data, location, cached) {
    const cacheIndicator = cached ? ' (cached)' : '';
    const dataSourceIndicator = data.isRealData ? ' 🌐' : ' 🎲 (simulated)';
    
    let weatherContent = [
      `🌤️ **Weather for ${data.location}**${cacheIndicator}${dataSourceIndicator}`,
      ''
    ];

    // Add error message if API failed but we have fallback data
    if (data.error) {
      weatherContent.push(`⚠️ ${data.error}`);
      weatherContent.push('*Showing simulated data instead*');
      weatherContent.push('');
    }

    // Main weather info
    weatherContent.push(`${data.icon} ${data.condition}`);
    if (data.description && data.description !== data.condition.toLowerCase()) {
      weatherContent.push(`*${data.description}*`);
    }
    weatherContent.push('');

    // Temperature info
    weatherContent.push(`🌡️ **Temperature:** ${data.temperature}°C`);
    if (data.feelsLike && data.feelsLike !== data.temperature) {
      weatherContent.push(`🤚 **Feels like:** ${data.feelsLike}°C`);
    }

    // Weather details
    weatherContent.push(`💧 **Humidity:** ${data.humidity}%`);
    if (data.pressure) {
      weatherContent.push(`📊 **Pressure:** ${data.pressure} hPa`);
    }
    
    // Wind information
    if (data.windSpeed > 0) {
      let windInfo = `💨 **Wind:** ${data.windSpeed} km/h`;
      if (data.windDirection) {
        windInfo += ` (${this.getWindDirection(data.windDirection)})`;
      }
      weatherContent.push(windInfo);
    }

    // Additional details for real data
    if (data.isRealData) {
      if (data.visibility) {
        weatherContent.push(`👁️ **Visibility:** ${data.visibility} km`);
      }
      if (data.cloudiness !== undefined) {
        weatherContent.push(`☁️ **Cloudiness:** ${data.cloudiness}%`);
      }
    }

    weatherContent.push('');
    weatherContent.push(`📅 **Updated:** ${new Date(data.timestamp).toLocaleTimeString()}`);

    return this.createResponse(weatherContent.join('\n'), BOT_RESPONSE_TYPES.TEXT, {
      location: data.location,
      temperature: data.temperature,
      condition: data.condition,
      cached: cached,
      isRealData: data.isRealData,
      hasError: !!data.error
    });
  }

  formatForecastResponse(data, location, cached) {
    const cacheIndicator = cached ? ' (cached)' : '';
    
    const forecastLines = data.forecast.map(day => 
      `${day.icon} **${day.day}**: ${day.condition} - High: ${day.high}°C, Low: ${day.low}°C`
    );

    const forecastContent = [
      `📅 **3-Day Forecast for ${data.location}**${cacheIndicator}`,
      '',
      ...forecastLines,
      '',
      `📅 Updated: ${new Date(data.timestamp).toLocaleTimeString()}`
    ].join('\n');

    return this.createResponse(forecastContent, BOT_RESPONSE_TYPES.TEXT, {
      location: data.location,
      forecast: data.forecast,
      cached: cached
    });
  }

  getWeatherIcon(condition) {
    const iconMap = {
      // OpenWeatherMap API conditions
      'Clear': '☀️',
      'Clouds': '☁️',
      'Rain': '🌧️',
      'Drizzle': '🌦️',
      'Thunderstorm': '⛈️',
      'Snow': '❄️',
      'Mist': '🌫️',
      'Fog': '🌫️',
      'Haze': '🌫️',
      'Dust': '🌪️',
      'Sand': '🌪️',
      'Ash': '🌋',
      'Squall': '💨',
      'Tornado': '🌪️',
      
      // Legacy/simulated conditions
      'Sunny': '☀️',
      'Cloudy': '☁️',
      'Rainy': '🌧️',
      'Partly Cloudy': '⛅',
      'Overcast': '☁️',
      'Foggy': '🌫️'
    };
    
    return iconMap[condition] || '🌤️';
  }

  // Convert wind direction degrees to compass direction
  getWindDirection(degrees) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degrees / 22.5) % 16;
    return directions[index];
  }

  // Simple cache implementation
  getFromCache(key) {
    const cached = this.weatherCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    this.weatherCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  // Clear expired cache entries
  clearExpiredCache() {
    const now = Date.now();
    for (const [key, value] of this.weatherCache.entries()) {
      if ((now - value.timestamp) >= this.cacheTimeout) {
        this.weatherCache.delete(key);
      }
    }
  }

  // Get cache statistics
  getCacheStats() {
    this.clearExpiredCache();
    return {
      entries: this.weatherCache.size,
      timeout: this.cacheTimeout / 1000 / 60 // in minutes
    };
  }

  // Configure API key (call this to enable real weather data)
  configureAPI(apiKey) {
    if (apiKey && apiKey.length > 10) {
      this.apiKey = apiKey;
      this.useRealAPI = true;
      console.log('✅ Weather API configured - real weather data enabled');
      return true;
    } else {
      console.warn('⚠️ Invalid API key provided');
      return false;
    }
  }

  // Get current configuration status
  getConfigStatus() {
    return {
      hasApiKey: this.apiKey !== 'YOUR_API_KEY_HERE',
      useRealAPI: this.useRealAPI,
      apiBaseUrl: this.apiBaseUrl,
      cacheTimeout: this.cacheTimeout / 1000 / 60 // in minutes
    };
  }
}

export default WeatherBot;