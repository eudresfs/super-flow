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
    version: "3.0",
    screen: "LOAN",
    data: {
      amount: "\u20b9 7,20,000",
      tenure: "24_months",
      emi: "\u20b9 20,000",
      rate: "9% pa",
      fee: "500",
    },
  },
  DETAILS: {
    version: "3.0",
    screen: "DETAILS",
    data: {},
  },
  SUMMARY: {
    version: "3.0",
    screen: "SUMMARY",
    data: {},
  },
  COMPLETE: {
    version: "3.0",
    screen: "COMPLETE",
    data: {},
  },
  SUCCESS: {
    version: "3.0",
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
      data: {
        ...LOAN_OPTIONS['12_months']
      },
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

      // handles when user completes DETAILS screen
      case "DETAILS":
        // the client payload contains selected ids from dropdown lists, we need to map them to names to display to user
        const departmentName =
          SCREEN_RESPONSES.APPOINTMENT.data.department.find(
            (dept) => dept.id === data.department
          ).title;
        const locationName = SCREEN_RESPONSES.APPOINTMENT.data.location.find(
          (loc) => loc.id === data.location
        ).title;
        const dateName = SCREEN_RESPONSES.APPOINTMENT.data.date.find(
          (date) => date.id === data.date
        ).title;

        const appointment = `${departmentName} at ${locationName}
${dateName} at ${data.time}`;

        const details = `Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone}
"${data.more_details}"`;

        return {
          ...SCREEN_RESPONSES.SUMMARY,
          data: {
            appointment,
            details,
            // return the same fields sent from client back to submit in the next step
            ...data,
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
