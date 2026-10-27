// Test data shaped like the public Instatus API of status.abaservices.ch (shared by the tests).

export const ABACUS_COMPONENTS = [
  {
    id: "g-central",
    name: "Zentrale Services",
    status: "OPERATIONAL",
    isParent: true,
    children: [
      { id: "c-idp", name: "Abacus IDP", status: "OPERATIONAL", description: "", isParent: false, children: [] },
      { id: "c-clock", name: "AbaClock", status: "OPERATIONAL", isParent: false, children: [] },
    ],
  },
  {
    id: "g-eco",
    name: "Ökosystem-Services",
    status: "OPERATIONAL",
    isParent: true,
    children: [
      { id: "c-deep", name: "Deep Cloud Services", status: "OPERATIONAL", isParent: false, children: [] },
      {
        id: "c-swiss21",
        name: "Swiss21 Services",
        status: "PARTIALOUTAGE",
        description: "Swiss21 cloud apps",
        isParent: false,
        children: [],
      },
    ],
  },
  {
    id: "g-bridge",
    name: "AbaBridge",
    status: "OPERATIONAL",
    isParent: true,
    children: [{ id: "c-kp1", name: "Kundenportal", status: "OPERATIONAL", isParent: false, children: [] }],
  },
  {
    id: "g-svm",
    name: "Service Management (SVM)",
    status: "OPERATIONAL",
    isParent: true,
    children: [{ id: "c-kp2", name: "Kundenportal", status: "MAJOROUTAGE", isParent: false, children: [] }],
  },
  { id: "c-city", name: "Abacus City", status: "OPERATIONAL", isParent: false, children: [] },
];

export const ABACUS_SUMMARY = {
  page: { name: "Abacus Cloud Services", url: "https://status.abaservices.ch", status: "HASISSUES" },
  activeIncidents: [
    {
      id: "i-1",
      name: "Swiss21 teilweise nicht erreichbar",
      started: "2026-10-26T08:00:00.000Z",
      status: "IDENTIFIED",
      impact: "PARTIALOUTAGE",
      url: "https://status.abaservices.ch/incident/i-1",
      updatedAt: "2026-10-26T08:30:00.000Z",
      lastUpdate: { message: "Die Ursache ist bekannt.", createdAt: "2026-10-26T08:30:00.000Z" },
    },
  ],
  activeMaintenances: [
    {
      id: "m-1",
      name: "Monatliches Release",
      start: "2026-10-29T11:00:00.000Z",
      status: "NOTSTARTEDYET",
      duration: "60",
      url: "https://status.abaservices.ch/maintenance/m-1",
      updatedAt: "2026-10-20T08:00:00.000Z",
    },
  ],
  recentlyResolvedIncidents: [
    {
      id: "i-0",
      name: "AbaClock langsam",
      started: "2026-10-20T07:00:00.000Z",
      resolved: "2026-10-20T09:00:00.000Z",
      impact: "DEGRADEDPERFORMANCE",
      url: "https://status.abaservices.ch/incident/i-0",
    },
  ],
};
