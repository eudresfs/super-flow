/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// this object is generated from Flow Builder under "..." > Endpoint > Snippets > Responses
// To navigate to a screen, return the corresponding response from the endpoint. Make sure the response is enccrypted.
const SCREEN_RESPONSES = {
    LOAN: {
        "version": "3.0",
        "screen": "LOAN",
        "data": {
            "tenure": [
                {
                    "id": "months12",
                    "title": "12 months"
                },
                {
                    "id": "months24",
                    "title": "24 months"
                },
                {
                    "id": "months36",
                    "title": "36 months"
                },
                {
                    "id": "months48",
                    "title": "48 months"
                }
            ],
            "amount": [
                {
                    "id": "amount1",
                    "title": "\u20b9 5,20,000"
                },
                {
                    "id": "amount2",
                    "title": "\u20b9 7,20,000"
                },
                {
                    "id": "amount3",
                    "title": "\u20b9 3,20,000"
                },
                {
                    "id": "amount4",
                    "title": "\u20b9 1,20,000"
                }
            ],
            "emi": [
                {
                    "id": "emi1",
                    "title": "\u20b9 20,000"
                },
                {
                    "id": "emi2",
                    "title": "\u20b9 40,000"
                },
                {
                    "id": "emi3",
                    "title": "\u20b9 60,000"
                },
                {
                    "id": "emi4",
                    "title": "\u20b9 80,000"
                }
            ],
            "rate": "9% pa",
            "fee": "500"
        }
    },
    DETAILS: {
        "version": "3.0",
        "screen": "DETAILS",
        "data": {}
    },
    SUMMARY: {
        "version": "3.0",
        "screen": "SUMMARY",
        "data": {}
    },
    COMPLETE: {
        "version": "3.0",
        "screen": "COMPLETE",
        "data": {}
    },
    SUCCESS: {
        "version": "3.0",
        "screen": "SUCCESS",
        "data": {
            "extension_message_response": {
                "params": {
                    "flow_token": "REPLACE_FLOW_TOKEN",
                    "some_param_name": "PASS_CUSTOM_VALUE"
                }
            }
        }
    },
};

const LOAN_OPTIONS = {
  "12_months": {
    amount: "720000",
    tenure: "12_months",
    emi: "5500",
    rate: "9% pa",
    fee: "500",
  },
  "24_months": {
    amount: "720000",
    tenure: "24_months",
    emi: "4500",
    rate: "9% pa",
    fee: "500",
  },
  "36_months": {
    amount: "720000",
    tenure: "36_months",
    emi: "3500",
    rate: "9% pa",
    fee: "500",
  },
  "48_months": {
    amount: "720000",
    tenure: "48_months",
    emi: "2500",
    rate: "9% pa",
    fee: "500",
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

  // handle initial request when opening the flow and display LOAN screen
  if (action === "INIT") {
    return {
      ...SCREEN_RESPONSES.LOAN,
      // data: {
      //   ...LOAN_OPTIONS['12_months']
      // },
    };
  }

  if (action === "data_exchange") {
    // handle the request based on the current screen
    switch (screen) {
      // handles when user interacts with LOAN screen
      case "LOAN":
        // update the loan quote based on user selected tenure
        return {
          ...SCREEN_RESPONSES.LOAN,
          data: {
            ...LOAN_OPTIONS[data.tenure]
          },
        };

      // handles when user completes SUMMARY screen
      case "SUMMARY":
        // TODO: save appointment to your database
        // send success response to complete and close the flow
        return {
          ...SCREEN_RESPONSES.COMPLETE,
          data: {},
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
