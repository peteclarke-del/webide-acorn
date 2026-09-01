/* Generated from api/openapi.json by scripts/generateApiTypes.mjs. Do not edit.
 *
 * The description is the contract. These types are what a client may rely on:
 * the server may answer with more, and those extra fields are deliberately
 * absent here, because a client that reads an undeclared field has nothing
 * stopping the server from removing it.
 *
 * WebIDE Acorn native builder and project store · version 1.0.0
 */

export const API_VERSION = "1.0.0" as const;

/** The one shape every refusal takes, on every route. A client cannot parse two error formats and should not have to discover which it got. */
export type Problem = {
  error: {
    /** A stable identifier for the refusal. Clients branch on this, never on the message. */
    code: string;
    /** Ties this refusal to the server's log line for it. */
    correlationId: string;
    /** What went wrong and what would fix it, in words meant for a person. */
    message: string;
    /** Whether sending the same request again could succeed. False means it never will. */
    retryable: boolean;
    /** Per-field detail where the refusal was about the request body. */
    fields: Record<string, string>;
  };
};

/** One thing that had to be true for a toolchain to be usable, and whether it was. */
export type Readiness = {
  /** What had to be true. */
  check: string;
  ok: boolean;
  /** What was found, so a failure names its own remedy. */
  detail: string;
};

/** What a server-side toolchain is and whether it can run. Answered with 503 when it cannot, so a client that ignores the body still learns the truth from the status. */
export type ToolchainManifest = {
  schema: "8bit-net.toolchain-manifest";
  version: 1;
  /** The adapter this manifest describes. */
  id: string;
  adapterVersion: string;
  label: string;
  execution: "server-native";
  language: string;
  artifactKind: string;
  processors: string[];
  profiles: string[];
  deterministic: boolean;
  packageVersion: string;
  limits: Record<string, unknown>;
  /** What the build is confined to. Declared so a caller can see it rather than trust it. */
  sandbox: {
    network: string;
    filesystem: string;
    identity: string;
    shell: boolean;
    persistence: string;
  };
  /** Whether a build sent now could run. False is answered with 503, not 200. */
  ready: boolean;
  readiness: Readiness[];
  digestAlgorithm: "sha256";
  /** Of the manifest itself, so a client can tell one toolchain from another. */
  digest: string;
};

/** The process is running. It says nothing about whether a build would succeed. */
export type HealthLive = {
  status: "live";
  service: string;
  apiVersion: 1;
};

/** Whether the service can do its job. 200 when ready, 503 when not. */
export type HealthReady = {
  status: "ready" | "not-ready";
  service: string;
  /** Every check that failed, across every toolchain, not the first. */
  unmet: UnmetCheck[];
  toolchain: ToolchainManifest;
  /** Every toolchain, in the order they are checked. */
  toolchains: ToolchainManifest[];
};

/** One header or source file from a server-side SDK, read-only. */
export type SdkDocument = {
  schema: "8bit-net.sdk-document";
  version: 1;
  toolchainId: string;
  toolchainVersion: string;
  /** Echoed back, so a client can refuse an answer to a question it did not ask. */
  path: string;
  source: string;
  /** Carried with the text, because a header copied into a project brings its terms with it. */
  licence: string;
  readOnly: true;
  bytes: number;
  sha256: string;
  content: string;
};

/** One thing the toolchain said about the source. */
export type BuildDiagnostic = {
  severity: "error" | "warning" | "info";
  message: string;
};

/** What the build produced, or absent when it produced nothing. A build that failed answers 200 with a null artifact and its diagnostics, because failing to assemble is an answer and not a transport error. */
export type BuildArtifact = {
  kind: string;
  /** The built bytes, encoded so that a binary survives JSON. */
  bytesBase64: string;
  origin: number;
  entryPoint?: number | null;
  processor: string;
  symbols: Record<string, unknown>;
  sourceMap?: Record<string, unknown>;
  listing?: Record<string, unknown>[];
  diagnostics: BuildDiagnostic[];
};

/** What happened during the build, whether or not it produced anything. */
export type BuildResult = {
  schema: "8bit-net.build-result";
  version: 1;
  invocation: {
    adapterId: string;
    adapterVersion: string;
    toolchainDigest: string;
    engine: string;
    profile?: string;
    machineId?: string;
  };
  exit: {
    reason: "succeeded" | "diagnostics" | "timeout" | "output-limit";
    errors: number;
    warnings: number;
  };
  timing: {
    durationMs: number;
  };
  cache?: {
    status: string;
    reason?: string;
  };
  size?: Record<string, unknown>;
  diagnostics: BuildDiagnostic[];
  logs?: string[];
};

/** What went in, what came out and what built it, so a rebuild can be compared rather than trusted. */
export type BuildProvenance = {
  schema: "8bit-net.build-provenance";
  version: 2;
  fingerprintAlgorithm?: string;
  digestAlgorithm?: "sha256";
  fingerprint: string;
  toolchain?: Record<string, unknown>;
  toolchainDigest: string;
  inputs: Record<string, unknown>[];
  output?: Record<string, unknown> | null;
};

/** A build to run. The schema and version are checked before anything else, so a client from another release is refused rather than half-understood. */
export type NativeBuildRequest = {
  schema: "8bit-net.native-build-request";
  version: 1;
  requestId: string;
  targetId?: string;
  machineId?: string;
  processor?: string;
  profile?: string;
  origin?: number;
  outputName?: string;
  files: {
    id?: string;
    name: string;
    content: string;
  }[];
};

/** The answer to a build, successful or not. */
export type NativeBuildResponse = {
  schema: "8bit-net.native-build-response";
  version: 1;
  /** Echoed, so a client with several builds in flight can tell them apart. */
  requestId: string;
  result: BuildResult;
  artifact: BuildArtifact | null;
  documents: Record<string, unknown>[];
  invocations: Record<string, unknown>[];
  provenance: BuildProvenance;
};

export type StoreIdentity = {
  owner: string;
  /** Always false in this build. Said in the response rather than left to be inferred, because a client that thought this was an account would be wrong about who can read it. */
  authenticated: boolean;
  detail: string;
};

/** What the store is, who it thinks you are, and how much of it is used. */
export type StoreUsage = {
  schema: "8bit-net.project-store";
  version: 1;
  identity: StoreIdentity;
  usage: {
    projects: number;
    revisions: number;
    bytes: number;
  };
  limits: Record<string, number>;
};

export type StoredProject = {
  id: string;
  revisions: number;
};

export type StoreProjects = {
  schema: "8bit-net.project-store-projects";
  version: 1;
  projects: StoredProject[];
};

export type StoredRevision = {
  id: string;
  /** The revision this was written against. Null for the first. */
  parent: string | null;
  writtenAt: string;
  note: string;
  /** How many files the revision holds. The manifest, not the content: a timeline is read far more often than a revision is restored. */
  files: number;
};

export type StoreRevisions = {
  schema: "8bit-net.project-store-revisions";
  version: 1;
  projectId: string;
  revisions: StoredRevision[];
};

export type StoreCommitRequest = {
  /** Filename to base64 content. Encoded so a binary asset survives the journey. */
  files: Record<string, string>;
  /** The revision this one was written against. A stale parent is refused rather than resolved, so two workbenches collide instead of one overwriting the other. */
  parent?: string | null;
  note?: string;
};

export type StoreCommitted = {
  schema: "8bit-net.project-revision";
  version: 1;
  revision: {
    id: string;
    parent: string | null;
    writtenAt: string;
    note: string;
    files: Record<string, unknown>;
  };
};

export type StoreRevisionContent = {
  schema: "8bit-net.project-store-revision-content";
  version: 1;
  projectId: string;
  revisionId: string;
  /** Filename to base64 content. */
  files: Record<string, string>;
};

export type StoreDeleteRequest = {
  /** The project being deleted, named again. A deletion that does not say what it means is refused, so a stray request cannot remove somebody's history. */
  confirmProjectId: string;
  reason?: string;
};

export type Tombstone = {
  projectId: string;
  revisions: number;
  deletedAt: string;
  reason?: string;
};

export type StoreTombstone = {
  schema: "8bit-net.project-tombstone";
  version: 1;
  tombstone: Tombstone;
};

/** What has been deleted, and when. Deleting without a trace is indistinguishable from a project that was never there. */
export type StoreTombstones = {
  schema: "8bit-net.project-store-tombstones";
  version: 1;
  tombstones: Tombstone[];
  detail: string;
};

/** What reclaiming space removed. Only content no revision names. */
export type StoreCollection = {
  schema: "8bit-net.project-store-collection";
  version: 1;
  collected: Record<string, unknown>;
  detail: string;
};

/** Everything one owner holds, history included. Work somebody cannot get out is work the store has taken. */
export type StoreExport = {
  schema: "8bit-net.project-store-export";
  version: 1;
};

/** One check that failed, named with the toolchain it belongs to, so whoever is looking at a not-ready service is told what to fix rather than only that something is wrong somewhere. */
export type UnmetCheck = {
  toolchain: string;
  check: string;
  detail: string;
};

/** One route the description declares. */
export interface ApiOperation {
  readonly method: string;
  /** With `{name}` where a path parameter goes. Use `apiPath` rather than building it by hand. */
  readonly path: string;
  readonly parameters: readonly { readonly name: string; readonly in: string; readonly required: boolean }[];
  readonly successStatus: number | null;
  readonly summary: string;
}

/**
 * Every route, keyed by operation.
 *
 * A client builds its request from here rather than from a string literal, so
 * a path that changes in the description fails to compile rather than 404ing
 * at somebody at runtime.
 */
export const API_OPERATIONS = {
  buildArmBinutils: {
    method: "POST",
    path: "/api/v1/builds/arm-binutils",
    parameters: [{"name":"X-8bit-Net-Request","in":"header","required":true}],
    successStatus: 200,
    summary: "Build with arm-binutils",
  },
  buildBeebAsm: {
    method: "POST",
    path: "/api/v1/builds/beebasm",
    parameters: [{"name":"X-8bit-Net-Request","in":"header","required":true}],
    successStatus: 200,
    summary: "Build with beebasm",
  },
  buildCa65: {
    method: "POST",
    path: "/api/v1/builds/ca65",
    parameters: [{"name":"X-8bit-Net-Request","in":"header","required":true}],
    successStatus: 200,
    summary: "Build with ca65",
  },
  buildCc65C: {
    method: "POST",
    path: "/api/v1/builds/cc65-c",
    parameters: [{"name":"X-8bit-Net-Request","in":"header","required":true}],
    successStatus: 200,
    summary: "Build with cc65-c",
  },
  healthLive: {
    method: "GET",
    path: "/api/health/live",
    parameters: [],
    successStatus: 200,
    summary: "Is the process running",
  },
  healthReady: {
    method: "GET",
    path: "/api/health/ready",
    parameters: [],
    successStatus: 200,
    summary: "Could a build run now",
  },
  sdkDocument: {
    method: "GET",
    path: "/api/v1/toolchains/cc65-c/sdk",
    parameters: [{"name":"path","in":"query","required":true}],
    successStatus: 200,
    summary: "Read one SDK header or source file",
  },
  storeCollect: {
    method: "POST",
    path: "/api/v1/store/collect",
    parameters: [],
    successStatus: 200,
    summary: "Reclaim space no revision names",
  },
  storeCommit: {
    method: "POST",
    path: "/api/v1/store/projects/{projectId}/revisions",
    parameters: [{"name":"projectId","in":"path","required":true}],
    successStatus: 201,
    summary: "Write a revision",
  },
  storeDelete: {
    method: "DELETE",
    path: "/api/v1/store/projects/{projectId}",
    parameters: [{"name":"projectId","in":"path","required":true}],
    successStatus: 200,
    summary: "Delete a project and every revision of it",
  },
  storeExport: {
    method: "GET",
    path: "/api/v1/store/export",
    parameters: [],
    successStatus: 200,
    summary: "Everything this owner holds, history included",
  },
  storeProjects: {
    method: "GET",
    path: "/api/v1/store/projects",
    parameters: [],
    successStatus: 200,
    summary: "Every project this owner holds",
  },
  storeRead: {
    method: "GET",
    path: "/api/v1/store/projects/{projectId}/revisions/{revisionId}",
    parameters: [{"name":"projectId","in":"path","required":true},{"name":"revisionId","in":"path","required":true}],
    successStatus: 200,
    summary: "The files one revision holds",
  },
  storeRevisions: {
    method: "GET",
    path: "/api/v1/store/projects/{projectId}/revisions",
    parameters: [{"name":"projectId","in":"path","required":true}],
    successStatus: 200,
    summary: "The history of one project",
  },
  storeTombstones: {
    method: "GET",
    path: "/api/v1/store/tombstones",
    parameters: [],
    successStatus: 200,
    summary: "What has been deleted, and when",
  },
  storeUsage: {
    method: "GET",
    path: "/api/v1/store",
    parameters: [],
    successStatus: 200,
    summary: "What the store is and how much of it is used",
  },
  toolchainArmBinutils: {
    method: "GET",
    path: "/api/v1/toolchains/arm-binutils",
    parameters: [],
    successStatus: 200,
    summary: "What the arm-binutils toolchain is and whether it can run",
  },
  toolchainBeebAsm: {
    method: "GET",
    path: "/api/v1/toolchains/beebasm",
    parameters: [],
    successStatus: 200,
    summary: "What the beebasm toolchain is and whether it can run",
  },
  toolchainCa65: {
    method: "GET",
    path: "/api/v1/toolchains/ca65",
    parameters: [],
    successStatus: 200,
    summary: "What the ca65 toolchain is and whether it can run",
  },
  toolchainCc65C: {
    method: "GET",
    path: "/api/v1/toolchains/cc65-c",
    parameters: [],
    successStatus: 200,
    summary: "What the cc65-c toolchain is and whether it can run",
  },
} as const satisfies Record<string, ApiOperation>;

export type ApiOperationId = keyof typeof API_OPERATIONS;

/** The response body of each operation that has one declared. */
export interface ApiResponses {
  buildArmBinutils: NativeBuildResponse;
  buildBeebAsm: NativeBuildResponse;
  buildCa65: NativeBuildResponse;
  buildCc65C: NativeBuildResponse;
  healthLive: HealthLive;
  healthReady: HealthReady;
  sdkDocument: SdkDocument;
  storeCollect: StoreCollection;
  storeCommit: StoreCommitted;
  storeDelete: StoreTombstone;
  storeExport: StoreExport;
  storeProjects: StoreProjects;
  storeRead: StoreRevisionContent;
  storeRevisions: StoreRevisions;
  storeTombstones: StoreTombstones;
  storeUsage: StoreUsage;
  toolchainArmBinutils: ToolchainManifest;
  toolchainBeebAsm: ToolchainManifest;
  toolchainCa65: ToolchainManifest;
  toolchainCc65C: ToolchainManifest;
}

/** The request body of each operation that takes one. */
export interface ApiRequests {
  buildArmBinutils: NativeBuildRequest;
  buildBeebAsm: NativeBuildRequest;
  buildCa65: NativeBuildRequest;
  buildCc65C: NativeBuildRequest;
  storeCommit: StoreCommitRequest;
  storeDelete: StoreDeleteRequest;
}

/**
 * A concrete path for an operation, with its parameters filled in.
 *
 * Every value is encoded. A project identifier with a slash in it would
 * otherwise address a different route, and the store refuses such a name — but
 * the client should not be the reason it never reaches the store to be refused.
 */
export function apiPath<Id extends ApiOperationId>(id: Id, values: Record<string, string> = {}): string {
  const operation: ApiOperation = API_OPERATIONS[id];
  return operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`${id} needs a ${name}, and none was given. The path would otherwise be sent with a brace in it.`);
    return encodeURIComponent(value);
  });
}
