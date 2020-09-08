function (user, context, callback) {
  // Packages
  const Axios = require('axios@0.19.2');
  const ManagementClient = require('auth0@2.9.1').ManagementClient;

  // Logging config
  const RULE_NAME = 'azure-graph-api';
  let ogConsoleLog = console.log;
  console.log = function () {
    let args = [];
    args.push(`[rule] [${RULE_NAME}] `);
    for (let x = 0; x < arguments.length; x++) {
      args.push(arguments[x]);
    }
    ogConsoleLog.apply(console, args);
  };

  // Configure local config object
  const CACHE_KEY = configuration.AUTH0_CLIENT_ID + '_token';
  const CACHED_TOKEN = global[CACHE_KEY];

  // Execution logic
  console.log('Start rule');

  getApiv2AccessToken(configuration.AUTH0_DOMAIN, configuration.AUTH0_CLIENT_ID, configuration.AUTH0_CLIENT_SECRET)
    .then(getIdpAccessToken)
    .then(getGroupsData)
    .then(parseGroupsData)
    .then(ctx => {
      console.log(`${ctx.filteredGroups.length} groups found`);
      console.log(ctx.filteredGroups);
      console.log('End rule');
      return callback(null, user, context);
    })
    .catch(err => {
      console.log('Rule terminated due to error: ${err}');
      return callback(new Error(`Rule error [${RULE_NAME}]: Unable to retrieve Groups data`));
    });

  // Function definitions
  function getApiv2AccessToken(domain, clientId, clientSecret) {
    if (CACHED_TOKEN && CACHED_TOKEN.expirationDate > Date.now()) {
      // Token is valid
      console.log(`[getApiv2AccessToken] Found cached access token: ${CACHED_TOKEN.accessToken}`);
      return new Promise((resolve, reject) => {
        return {
          domain: domain,
          accessToken: CACHED_TOKEN.accessToken
        };
      });
    }

    // If token is not present or expired, get a new one
    console.log(`[getApiv2AccessToken] Retrieving new access token...`);
    let options = {
      url: `https://${domain}/oauth/token`,
      method: 'POST',
      data: {
        client_id: clientId,
        client_secret: clientSecret,
        audience: `https://${domain}/api/v2/`,
        grant_type: 'client_credentials'
      },
      headers: {
        'Content-Type': 'application/json'
      }
    };

    return Axios(options)
      .then(res => {
        global[CACHE_KEY] = {
          accessToken: res.data.access_token,
          // 60 seconds safe window time
          expirationDate: Date.now() + (res.data.expires_in - 60) * 1000
        };
        console.log(`[getApiv2AccessToken] Retrieved and cached new access token: ${global[CACHE_KEY].accessToken}`);
        return {
          domain: domain,
          accessToken: res.data.access_token
        };
      })
      .catch(err => {
        if (err.response) {
          throw new Error(`[getApiv2AccessToken] Could not retrieve access token: ${err.response.status}: ${JSON.stringify(err.response.data)}`);
        } else if (err.request) {
          throw new Error(`[getApiv2AccessToken] Request for access token failed: ${err.request}`);
        } else {
          throw new Error(`[getApiv2AccessToken] Axios failed: ${err.message}`);
        }
      });
  }

  function getIdpAccessToken(ctx) {
    let managementClient = new ManagementClient({
      domain: ctx.domain,
      token: ctx.accessToken
    });

    return managementClient.users.get({
        id: user.user_id
      })
      .then(user => {
        console.log(`[getIdpAccessToken] User found:\n${JSON.stringify(user)}`);
        if (!user.identities[0].hasOwnProperty('access_token')) {
          throw new Error(`[getIdpAccessToken] User identity does not have property 'access_token'`);
        }
        return {
          idpAccessToken: user.identities[0].access_token
        };
      })
      .catch(err => {
        throw new Error(`[getIdpAccessToken] Could not retrieve IdP Access Token: ${err}`);
      });
  }

  function getGroupsData(ctx) {
    let options = {
      url: 'https://graph.microsoft.com/v1.0/me/memberOf',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ctx.idpAccessToken}`
      }
    };

    return Axios(options)
      .then(res => {
        console.log(`[getGroupsData] Groups data found:\n${JSON.stringify(res.data.value)}`);
        return {
          groupsData: res.data.value
        };
      })
      .catch(err => {
        if (err.response) {
          throw new Error(`[getGroupsData] Could not retrieve Groups data from Graph API: (${err.response.status}) ${err.response.data}`);
        } else if (err.request) {
          throw new Error(`[getGroupsData] Request failed: ${err.request}`);
        } else {
          throw new Error(`[getGroupsData] Axios failed: ${err.message}`);
        }
      });
  }

  function parseGroupsData(ctx) {
    return new Promise((resolve, reject) => {
      let filteredGroups = ctx.groupsData.map(x => ({
        id: x.id,
        name: x.displayName
      }));
      console.log(`[parseGroupsData] Groups data filtered`);

      resolve({
        filteredGroups: filteredGroups
      });
    });
  }
}