# Mapillary integration (September 2025 refresh)

Mapillary migrated to an OAuth 2.0 flow for client applications in September 2025. Apps now need to exchange a **client ID** and **client secret** for a short-lived access token before any Graph API calls succeed. Follow the steps below whenever you need to connect Geolocator to Mapillary imagery:

1. Visit the [Mapillary developer dashboard](https://www.mapillary.com/dashboard/developers) and create or select an application.
2. Copy the numeric **client ID** and the **client secret** that Mapillary issues for the app. Keep both values private.
3. Exchange the credentials for a temporary token by calling the Graph API token endpoint:
   ```http
   POST https://graph.mapillary.com/token
   Content-Type: application/x-www-form-urlencoded

   client_id=<YOUR_CLIENT_ID>
   client_secret=<YOUR_CLIENT_SECRET>
   grant_type=client_credentials
   ```
   The response contains an `access_token` and an `expires_in` duration (in seconds). Tokens generally expire within an hour, so refresh them frequently.
4. Use the returned `access_token` in subsequent Graph API calls, for example when searching for imagery: `https://graph.mapillary.com/images?access_token=<TOKEN>&fields=id,computed_geometry&bbox=...`.
5. When a token expires (HTTP 401/403), request a fresh one with the same client credentials.

The Geolocator UI automates these steps: enter your client ID and secret in the **Mapillary Access** panel, click **Refresh token**, and the app will request and store a token until it expires. The Mapillary launch button stays disabled until a valid token is present.
