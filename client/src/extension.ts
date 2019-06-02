"use strict";

import * as path from "path";
import {
  ExtensionContext,
  OutputChannel,
  RelativePattern,
  Uri,
  window as Window,
  workspace,
} from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient";

let languageClient: LanguageClient;
const elmJsonGlob = "**/elm.json";

export async function activate(context: ExtensionContext) {
  // We get activated if there is one or more elm.json file in the workspace
  // Start one server for each workspace with at least one elm.json
  // and watch Elm files in those directories.

  const elmJsons = await workspace.findFiles(elmJsonGlob, "**/node_modules/**");
  // Todo do this smarter
  if (elmJsons) {
    const workspaceFolder = workspace.getWorkspaceFolder(elmJsons[0]);
    const elmJsonFolder = getElmJsonFolder(elmJsons[0]);
    if (workspaceFolder) {
      startClient(context, elmJsonFolder);
    }
  }

  const watcher = workspace.createFileSystemWatcher(
    elmJsonGlob,
    false,
    true,
    false,
  );
  watcher.onDidCreate(uri => {
    const workspaceFolder = workspace.getWorkspaceFolder(uri);
    const elmJsonFolder = getElmJsonFolder(uri);
    if (workspaceFolder) {
      startClient(context, elmJsonFolder);
    }
  });
  watcher.onDidDelete(uri => {
    const workspaceFolder = workspace.getWorkspaceFolder(uri);
    const elmJsonFolder = getElmJsonFolder(uri);
    if (workspaceFolder) {
      stopClient(elmJsonFolder);
    }
  });
}

function getElmJsonFolder(uri: Uri): Uri {
  return Uri.parse(uri.toString().replace("elm.json", ""));
}

async function stopClient(workspaceUri: Uri) {
  const client = clients.get(workspaceUri.fsPath);

  if (client) {
    const pattern = new RelativePattern(workspaceUri.fsPath, elmJsonGlob);
    const files = await workspace.findFiles(pattern, "**/node_modules/**");
    if (files.length === 0) {
      languageClient.info("Found the client shutting it down.");
      client.stop();
      clients.delete(workspaceUri.fsPath);
    } else {
      languageClient.info(
        "There are still elm.json files in this workspace, not stopping the client.",
      );
    }
  } else {
    languageClient.info("Could not find the client that we want to shutdown.");
  }
}

const clients: Map<string, LanguageClient> = new Map();
function startClient(context: ExtensionContext, elmWorkspace: Uri) {
  if (clients.has(elmWorkspace.fsPath)) {
    // Client was already started for this directory
    return;
  }

  const serverModule = context.asAbsolutePath(
    path.join("server", "out", "index.js"),
  );
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = {
    execArgv: ["--nolazy", `--inspect=${6010 + clients.size}`],
  };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    debug: {
      module: serverModule,
      options: debugOptions,
      transport: TransportKind.ipc,
    },
    run: { module: serverModule, transport: TransportKind.ipc },
  };
  const outputChannel: OutputChannel = Window.createOutputChannel("elmLS");

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    diagnosticCollectionName: "elmLS",
    // Register the server for Elm documents in the directory
    documentSelector: [
      {
        pattern: "**/*.elm",
        scheme: "file",
      },
    ],
    initializationOptions: { elmWorkspace: elmWorkspace.toString() },
    outputChannel,
    // Notify the server about file changes to 'elm.json'
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher(
        path.join(elmWorkspace.fsPath, elmJsonGlob),
      ),
    },
  };

  // Create the language client and start the client.
  languageClient = new LanguageClient(
    "elmLanguageServer",
    "Elm Language Server",
    serverOptions,
    clientOptions,
  );

  // Start the client. This will also launch the server
  languageClient.start();
  languageClient.info(`Starting language server for ${elmWorkspace.fsPath}`);
  clients.set(elmWorkspace.fsPath, languageClient);
}

export function deactivate(): Thenable<void> | undefined {
  const promises: Array<Thenable<void>> = [];
  for (const client of clients.values()) {
    promises.push(client.stop());
  }
  return Promise.all(promises).then(() => undefined);
}
