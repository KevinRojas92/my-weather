'use strict';

// OpenWeatherMap: current weather by coordinates
// https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={apiKey}
const API_KEY = "698602930bd82be2ecbd605539371c85";
const WEATHER_URL = "https://api.openweathermap.org/data/2.5/weather";

// Open-Meteo: city search for the predictive search box (free, no API key)
// https://open-meteo.com/en/docs/geocoding-api
const CITY_SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search";

// Fallback when the browser doesn't share its location (free, no API key)
const IP_LOCATION_URL = "https://get.geojs.io/v1/ip/geo.json";

const STORAGE_KEY = "myweather_last_search";
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 6;
const SEARCH_DELAY_MS = 250;

const searchForm = document.getElementById("search_form");
const searchInput = document.getElementById("search_input");
const searchButton = document.getElementById("search_button");
const suggestionsList = document.getElementById("suggestions");
const myLocationButton = document.getElementById("my_location");
const message = document.getElementById("message");
const locationTitle = document.getElementById("location");
const weatherIcon = document.getElementById("weather_icon");

const values = {
    condition: document.getElementById("value_condition"),
    temp_max: document.getElementById("value_temp_max"),
    temp_min: document.getElementById("value_temp_min"),
    humidity: document.getElementById("value_humidity"),
    feels_like: document.getElementById("value_feels_like"),
    pressure: document.getElementById("value_pressure"),
    wind_speed: document.getElementById("value_wind_speed")
};

/* ---------- Messages and loading state ---------- */

function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
}

function setLoading(isLoading) {
    searchButton.disabled = isLoading;
    myLocationButton.disabled = isLoading;
    document.body.classList.toggle("loading", isLoading);
}

/* ---------- Rendering the weather ---------- */

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function showWeather(placeName, weather) {
    locationTitle.textContent = placeName;

    values.condition.textContent = weather.condition;
    values.temp_max.textContent = weather.temp_max;
    values.temp_min.textContent = weather.temp_min;
    values.humidity.textContent = weather.humidity;
    values.feels_like.textContent = weather.feels_like;
    values.pressure.textContent = weather.pressure;
    values.wind_speed.textContent = weather.wind_speed;

    if (weather.icon) {
        weatherIcon.src = `https://openweathermap.org/img/wn/${weather.icon}@2x.png`;
        weatherIcon.alt = weather.condition;
        weatherIcon.hidden = false;
    } else {
        weatherIcon.hidden = true;
    }
}

// Turns the API response into the values the app displays
function parseWeather(json) {
    return {
        condition: capitalize(json.weather[0].description),
        icon: json.weather[0].icon,
        temp_max: Math.round(json.main.temp_max),
        temp_min: Math.round(json.main.temp_min),
        humidity: json.main.humidity,
        feels_like: Math.round(json.main.feels_like),
        pressure: json.main.pressure,
        // With units=metric the API returns wind speed in m/s: convert it to km/h
        wind_speed: Math.round(json.wind.speed * 3.6)
    };
}

/* ---------- Saving and reading the last search ---------- */

function saveLastSearch(search) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(search));
    } catch (error) {
        // If the browser can't save (private mode, etc.) the app still works
    }
}

function readLastSearch() {
    try {
        const search = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (search && typeof search.lat === "number" && typeof search.lon === "number") {
            return search;
        }
    } catch (error) {
        // Corrupted saved data: ignore it
    }
    return null;
}

/* ---------- API calls ---------- */

async function fetchJSON(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Error ${response.status} requesting ${url}`);
    }
    return response.json();
}

// Gets the weather for some coordinates, shows it and saves it
async function loadWeather(lat, lon, placeName) {
    const json = await fetchJSON(`${WEATHER_URL}?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=en`);
    const weather = parseWeather(json);
    const name = placeName || [json.name, json.sys && json.sys.country].filter(Boolean).join(", ");

    showWeather(name, weather);
    saveLastSearch({ name, lat, lon, weather });
}

// Searches cities whose name starts with the text. Only returns cities:
// countries, regions, airports, etc. are filtered out.
async function searchCities(query, signal) {
    const url = `${CITY_SEARCH_URL}?name=${encodeURIComponent(query)}&count=20&language=en&format=json`;
    const json = await fetchJSON(url, { signal });
    const results = json.results || [];

    const cities = [];
    const seen = new Set();

    for (const place of results) {
        // GeoNames "PPL*" feature codes are populated places (cities, towns, capitals...)
        if (!place.feature_code || !place.feature_code.startsWith("PPL")) {
            continue;
        }

        const region = place.admin1 && place.admin1 !== place.name ? place.admin1 : "";
        const key = `${place.name}|${region}|${place.country_code}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        cities.push({
            name: place.name,
            region,
            country: place.country || place.country_code || "",
            countryCode: place.country_code || "",
            lat: place.latitude,
            lon: place.longitude
        });

        if (cities.length === MAX_SUGGESTIONS) {
            break;
        }
    }

    return cities;
}

function cityLabel(city) {
    return [city.name, city.region, city.countryCode].filter(Boolean).join(", ");
}

/* ---------- Predictive search ---------- */

let suggestions = [];
let activeIndex = -1;
let searchTimer = null;
let searchController = null;

function closeSuggestions() {
    suggestions = [];
    activeIndex = -1;
    suggestionsList.innerHTML = "";
    suggestionsList.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
}

function renderSuggestions(cities) {
    suggestions = cities;
    activeIndex = -1;
    suggestionsList.innerHTML = "";
    searchInput.removeAttribute("aria-activedescendant");

    if (cities.length === 0) {
        closeSuggestions();
        return;
    }

    cities.forEach((city, index) => {
        const item = document.createElement("li");
        item.id = `suggestion_${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");

        item.textContent = city.name;
        const detail = document.createElement("small");
        detail.textContent = [city.region, city.country].filter(Boolean).join(", ");
        item.appendChild(detail);

        // mousedown (not click) so it runs before the input loses focus
        item.addEventListener("mousedown", event => {
            event.preventDefault();
            chooseCity(city);
        });

        suggestionsList.appendChild(item);
    });

    suggestionsList.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
}

function highlightSuggestion(index) {
    const items = suggestionsList.querySelectorAll("li");
    items.forEach((item, i) => item.setAttribute("aria-selected", i === index ? "true" : "false"));
    activeIndex = index;

    if (index >= 0) {
        searchInput.setAttribute("aria-activedescendant", items[index].id);
        items[index].scrollIntoView({ block: "nearest" });
    } else {
        searchInput.removeAttribute("aria-activedescendant");
    }
}

async function updateSuggestions(query) {
    if (searchController) {
        searchController.abort();
    }
    searchController = new AbortController();

    try {
        const cities = await searchCities(query, searchController.signal);
        // Ignore the answer if the user kept typing in the meantime
        if (searchInput.value.trim() === query) {
            renderSuggestions(cities);
        }
    } catch (error) {
        if (error.name !== "AbortError") {
            console.error(error);
            closeSuggestions();
        }
    }
}

async function chooseCity(city) {
    closeSuggestions();
    searchInput.value = "";
    setLoading(true);
    showMessage("Loading weather…");

    try {
        await loadWeather(city.lat, city.lon, cityLabel(city));
        showMessage("");
    } catch (error) {
        console.error(error);
        showMessage("Something went wrong while getting the weather. Check your connection and try again.", true);
    } finally {
        setLoading(false);
    }
}

searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();
    clearTimeout(searchTimer);

    if (query.length < MIN_QUERY_LENGTH) {
        if (searchController) {
            searchController.abort();
        }
        closeSuggestions();
        return;
    }

    searchTimer = setTimeout(() => updateSuggestions(query), SEARCH_DELAY_MS);
});

searchInput.addEventListener("keydown", event => {
    if (suggestionsList.hidden) {
        return;
    }

    if (event.key === "ArrowDown") {
        event.preventDefault();
        highlightSuggestion((activeIndex + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlightSuggestion(activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        chooseCity(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
        closeSuggestions();
    }
});

searchInput.addEventListener("blur", closeSuggestions);

// Pressing "Search" without picking a suggestion uses the best match
searchForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearTimeout(searchTimer);

    const query = searchInput.value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
        showMessage("Type the name of a city.", true);
        searchInput.focus();
        return;
    }

    setLoading(true);
    showMessage("Searching…");

    try {
        const cities = await searchCities(query);
        if (cities.length === 0) {
            showMessage(`We couldn't find a city called "${query}". Check the name and try again.`, true);
            setLoading(false);
            return;
        }
        await chooseCity(cities[0]);
    } catch (error) {
        console.error(error);
        showMessage("Something went wrong while searching. Check your connection and try again.", true);
        setLoading(false);
    }
});

/* ---------- Automatic location detection ---------- */

function getBrowserPosition() {
    return new Promise((resolve, reject) => {
        if (!("geolocation" in navigator)) {
            reject(new Error("Geolocation not available"));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            position => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
            reject,
            { timeout: 10000, maximumAge: 10 * 60 * 1000 }
        );
    });
}

async function getPositionFromIP() {
    const json = await fetchJSON(IP_LOCATION_URL);
    const lat = parseFloat(json.latitude);
    const lon = parseFloat(json.longitude);
    if (isNaN(lat) || isNaN(lon)) {
        throw new Error("Invalid IP location response");
    }
    return { lat, lon };
}

async function detectLocation() {
    setLoading(true);
    showMessage("Detecting your location…");

    try {
        let position;
        let isApproximate = false;
        try {
            // 1) Precise location from the browser (asks the user for permission)
            position = await getBrowserPosition();
        } catch (error) {
            // 2) If permission is denied or it fails, approximate location from the IP
            position = await getPositionFromIP();
            isApproximate = true;
        }

        await loadWeather(position.lat, position.lon);

        if (isApproximate) {
            // IP location can be a nearby city (where the internet provider is)
            showMessage("Approximate location. If this isn't your city, search for it above or allow location access.");
        } else {
            showMessage("");
        }
        return true;
    } catch (error) {
        console.error(error);
        showMessage("We couldn't detect your location. Search for a city to see its weather.", true);
        return false;
    } finally {
        setLoading(false);
    }
}

myLocationButton.addEventListener("click", () => detectLocation());

/* ---------- App start ---------- */

async function start() {
    // Remove the keys used by previous versions of the app
    try {
        ["lugar", "ubicacion", "myweather_ultima_consulta"].forEach(key => localStorage.removeItem(key));
    } catch (error) {}

    // Read it before detecting, because a successful detection overwrites it
    const lastSearch = readLastSearch();

    // Every visit: detect where the user is right now
    const detected = await detectLocation();

    // If detection fails (offline, blocked...), fall back to the last city checked
    if (!detected && lastSearch && lastSearch.weather) {
        showWeather(lastSearch.name, lastSearch.weather);
        showMessage("We couldn't detect your location: showing the last city you checked.", true);
    }
}

start();

// Service worker so the app works as a PWA (installable and cached)
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(error => console.error("Service worker registration failed", error));
    });
}
