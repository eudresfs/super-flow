/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// this object is generated from Flow Builder under "..." > Endpoint > Snippets > Responses
// To navigate to a screen, return the corresponding response from the endpoint. Make sure the response is enccrypted.
const SCREEN_RESPONSES = {
  account: {
    screen: "account",
    data: {},
  },
  infos: {
    screen: "infos",
    data: {
      name: "João da Silva",
      maxDate: "2006-10-10",
      minDate: "1950-10-10",
    },
  },
  address: {
    screen: "address",
    data: {},
  },
  SUCCESS: {
    screen: "SUCCESS",
    data: {
      extension_message_response: {
        params: {
          flow_token: "REPLACE_FLOW_TOKEN",
          some_param_name: "PASS_CUSTOM_VALUE",
        },
      },
    },
  },
};

export const getNextScreen = async (decryptedBody) => {
  const { screen, data, version, action, flow_token } = decryptedBody;

  // handle health check request
  if (action === "ping") {
    return {
      version,
      data: {
        status: "active",
      },
    };
  }

  // handle error notification
  if (data?.error) {
    console.warn("Received client error:", data);
    return {
      version,
      data: {
        acknowledged: true,
      },
    };
  }

  // handle initial request when opening the flow and display account screen
  if (action === "INIT") {
    return {
      ...SCREEN_RESPONSES.account,
    };
  }

  if (action === "data_exchange") {
    switch (screen) {
      // handles user interacting with account screen
      case "account":
        // If user proceeds from account screen, show the infos screen
        return {
          ...SCREEN_RESPONSES.infos,
        };

      // handles user interacting with infos screen
      case "infos":
        // After completing infos screen, navigate to address screen
        return {
          ...SCREEN_RESPONSES.address,
        };

      // handles user interacting with address screen
      case "address":
        // After completing address screen, send success response
        return {
          ...SCREEN_RESPONSES.SUCCESS,
        };

      default:
        break;
    }
  }

  console.error("Unhandled request body:", decryptedBody);
  throw new Error(
    "Unhandled endpoint request. Make sure you handle the request action & screen logged above."
  );
};