(function() {
  class MapillaryAuth {
    constructor() {
      this.clientIdKey = 'mapillaryClientId';
      this.clientSecretKey = 'mapillaryClientSecret';
      this.accessTokenKey = 'mapillaryAccessToken';
      this.expiryKey = 'mapillaryTokenExpiry';
      this.pending = null;
    }

    loadCredentials() {
      return {
        clientId: localStorage.getItem(this.clientIdKey) || '',
        clientSecret: localStorage.getItem(this.clientSecretKey) || ''
      };
    }

    saveCredentials(clientId, clientSecret) {
      if (clientId) {
        localStorage.setItem(this.clientIdKey, clientId);
      } else {
        localStorage.removeItem(this.clientIdKey);
      }

      if (clientSecret) {
        localStorage.setItem(this.clientSecretKey, clientSecret);
      } else {
        localStorage.removeItem(this.clientSecretKey);
      }

      this.clearAccessToken(false);
      this.notify();
    }

    clearCredentials() {
      localStorage.removeItem(this.clientIdKey);
      localStorage.removeItem(this.clientSecretKey);
      this.clearAccessToken(false);
      this.notify();
    }

    clearAccessToken(shouldNotify = true) {
      localStorage.removeItem(this.accessTokenKey);
      localStorage.removeItem(this.expiryKey);
      if (shouldNotify) {
        this.notify();
      }
    }

    getStoredToken() {
      const token = localStorage.getItem(this.accessTokenKey);
      const expires = parseInt(localStorage.getItem(this.expiryKey), 10);
      if (!token || Number.isNaN(expires)) {
        return null;
      }
      return { token, expiresAt: expires };
    }

    getStatus() {
      const { clientId, clientSecret } = this.loadCredentials();
      const stored = this.getStoredToken();
      const now = Date.now();
      const hasToken = !!(stored && stored.expiresAt > now + 60000);
      const minutesRemaining = stored ? Math.max(0, Math.floor((stored.expiresAt - now) / 60000)) : 0;
      return {
        hasCredentials: !!(clientId && clientSecret),
        hasToken,
        tokenExpiresAt: stored ? stored.expiresAt : null,
        minutesRemaining,
        pending: !!this.pending
      };
    }

    async getAccessToken(forceRefresh = false) {
      const stored = this.getStoredToken();
      if (!forceRefresh && stored && stored.expiresAt > Date.now() + 60000) {
        return stored.token;
      }
      return this.refreshAccessToken();
    }

    async refreshAccessToken() {
      if (this.pending) {
        return this.pending;
      }

      const { clientId, clientSecret } = this.loadCredentials();
      if (!clientId || !clientSecret) {
        throw new Error('Mapillary client ID and secret are not configured.');
      }

      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      });

      this.pending = (async () => {
        let response;
        try {
          response = await fetch('https://graph.mapillary.com/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString(),
            signal: AbortSignal.timeout(15000) // 15 second timeout
          });
        } catch (networkError) {
          if (networkError.name === 'AbortError') {
            throw new Error('Token request timed out. Please check your internet connection and try again.');
          }
          throw new Error(`Network error while requesting Mapillary token: ${networkError.message}`);
        }

        const raw = await response.text();
        let data = {};
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (parseError) {
            throw new Error('Unable to parse Mapillary token response.');
          }
        }

        if (!response.ok) {
          const apiMessage = data && data.error && data.error.message;
          throw new Error(apiMessage || `Token request failed (${response.status})`);
        }

        if (!data.access_token) {
          throw new Error('Token response did not include an access token.');
        }

        const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
        const expiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
        localStorage.setItem(this.accessTokenKey, data.access_token);
        localStorage.setItem(this.expiryKey, String(expiresAt));
        this.notify();
        return data.access_token;
      })()
        .catch(error => {
          this.clearAccessToken(false);
          throw error;
        })
        .finally(() => {
          this.pending = null;
          this.notify();
        });

      this.notify();
      return this.pending;
    }

    notify() {
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
        document.dispatchEvent(new CustomEvent('mapillary-auth-updated', {
          detail: this.getStatus()
        }));
      }
    }
  }

  window.mapillaryAuth = new MapillaryAuth();

  document.addEventListener('DOMContentLoaded', () => {
    const clientIdInput = document.getElementById('mapillaryClientId');
    const clientSecretInput = document.getElementById('mapillaryClientSecret');
    const statusEl = document.getElementById('mapillaryTokenStatus');
    const saveBtn = document.getElementById('mapillarySaveCredentials');
    const clearBtn = document.getElementById('mapillaryClearCredentials');
    const refreshBtn = document.getElementById('mapillaryRefreshToken');
    const launchBtn = document.getElementById('mapillaryLaunchButton');

    if (!clientIdInput || !clientSecretInput || !statusEl) {
      return;
    }

    const renderStatus = (status = mapillaryAuth.getStatus(), messageOverride) => {
      if (!statusEl) {
        return;
      }

      statusEl.classList.remove('mapillary-settings__status--error', 'mapillary-settings__status--success');

      let message = messageOverride;
      if (!message) {
        if (!status.hasCredentials) {
          message = 'No Mapillary credentials saved.';
        } else if (status.pending) {
          message = 'Requesting Mapillary access token…';
        } else if (status.hasToken) {
          const minutes = status.minutesRemaining;
          message = minutes > 0
            ? `Token active • expires in about ${minutes} min`
            : 'Token active • expires in less than a minute';
          statusEl.classList.add('mapillary-settings__status--success');
        } else {
          message = 'Credentials saved. Refresh the token to enable Mapillary imagery.';
        }
      }

      statusEl.textContent = message;

      if (launchBtn) {
        launchBtn.disabled = !status.hasToken;
        launchBtn.title = status.hasToken
          ? 'Open Mapillary imagery for the selected location'
          : 'Save credentials and refresh the Mapillary token first.';
      }

      if (refreshBtn) {
        refreshBtn.disabled = status.pending || !status.hasCredentials;
      }
    };

    const { clientId, clientSecret } = mapillaryAuth.loadCredentials();
    clientIdInput.value = clientId;
    clientSecretInput.value = clientSecret;
    renderStatus();

    const handleError = (error) => {
      if (!statusEl) {
        return;
      }
      statusEl.classList.remove('mapillary-settings__status--success');
      statusEl.classList.add('mapillary-settings__status--error');
      statusEl.textContent = error.message || 'Mapillary token request failed.';
    };

    const requestToken = async () => {
      try {
        renderStatus(mapillaryAuth.getStatus(), 'Requesting Mapillary access token…');
        await mapillaryAuth.refreshAccessToken();
        const status = mapillaryAuth.getStatus();
        statusEl.classList.remove('mapillary-settings__status--error');
        statusEl.classList.add('mapillary-settings__status--success');
        const minutes = status.minutesRemaining;
        statusEl.textContent = minutes > 0
          ? `Token refreshed • expires in about ${minutes} min`
          : 'Token refreshed • expires in less than a minute';
        renderStatus(status, statusEl.textContent);
      } catch (error) {
        handleError(error);
      }
    };

    if (saveBtn) {
      saveBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        const idValue = clientIdInput.value.trim();
        const secretValue = clientSecretInput.value.trim();
        mapillaryAuth.saveCredentials(idValue, secretValue);
        if (idValue && secretValue) {
          await requestToken();
        } else {
          renderStatus();
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        mapillaryAuth.clearCredentials();
        clientIdInput.value = '';
        clientSecretInput.value = '';
        statusEl.classList.remove('mapillary-settings__status--error', 'mapillary-settings__status--success');
        statusEl.textContent = 'Mapillary credentials cleared.';
        renderStatus();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        const status = mapillaryAuth.getStatus();
        if (!status.hasCredentials) {
          handleError(new Error('Enter client ID and secret, then save before refreshing.'));
          return;
        }
        await requestToken();
      });
    }

    document.addEventListener('mapillary-auth-updated', (event) => {
      renderStatus(event.detail);
    });
  });
})();
