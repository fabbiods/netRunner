import { ApplicationError, NotFoundError } from '../errors.mjs';

const SESSION_ONLY_COMMANDS = new Set(['set cli screen-length 0', 'skip', 'terminal length 0']);

const families = [
  {
    deviceType: 'switch',
    id: 'ruckus-fastiron-switches',
    management: 'ssh',
    models: ['ICX8200', 'ICX7550', 'ICX7150'],
    runbooks: [
      {
        commands: ['skip', 'show running-config'],
        description: 'Desativa a paginação somente na sessão e exibe a configuração ativa.',
        id: 'ruckus-fastiron-configuration',
        kind: 'snapshot',
        name: 'Coletar configuração ativa',
      },
      {
        commands: ['show version'],
        description: 'Exibe versão do FastIron e identificação do equipamento.',
        id: 'ruckus-fastiron-version',
        kind: 'diagnostic',
        name: 'Consultar versão',
      },
    ],
    system: 'FastIron',
    vendor: 'ruckus',
    vendorLabel: 'Ruckus',
  },
  {
    deviceType: 'switch',
    id: 'juniper-ex-switches',
    management: 'ssh',
    models: ['EX3300', 'EX4100', 'EX4300', 'EX4400'],
    runbooks: [
      {
        commands: ['set cli screen-length 0', 'show configuration'],
        description: 'Desativa a paginação somente na sessão e exibe a configuração ativa.',
        id: 'juniper-junos-configuration',
        kind: 'snapshot',
        name: 'Coletar configuração ativa',
      },
      {
        commands: ['show version'],
        description: 'Exibe versão do Junos e identificação do equipamento.',
        id: 'juniper-junos-version',
        kind: 'diagnostic',
        name: 'Consultar versão',
      },
    ],
    system: 'Junos',
    vendor: 'juniper',
    vendorLabel: 'Juniper',
  },
  {
    deviceType: 'switch',
    id: 'cisco-catalyst-switches',
    management: 'ssh',
    models: ['Catalyst 9300', 'Catalyst 9200', 'Catalyst 9500'],
    runbooks: [
      {
        commands: ['terminal length 0', 'show running-config'],
        description: 'Desativa a paginação somente na sessão e exibe a configuração ativa.',
        id: 'cisco-iosxe-configuration',
        kind: 'snapshot',
        name: 'Coletar configuração ativa',
      },
      {
        commands: ['show version'],
        description: 'Exibe versão do IOS-XE e identificação do equipamento.',
        id: 'cisco-iosxe-version',
        kind: 'diagnostic',
        name: 'Consultar versão',
      },
    ],
    system: 'IOS-XE',
    vendor: 'cisco',
    vendorLabel: 'Cisco',
  },
  {
    deviceType: 'access-point',
    id: 'aruba-central-access-points',
    management: 'cloud',
    managementLabel: 'Aruba Central',
    models: ['AP535', 'AP505', 'AP515', 'AP655', 'AP635', 'AP375', 'AP303'],
    runbooks: [],
    system: 'Aruba Central',
    vendor: 'aruba',
    vendorLabel: 'Aruba',
  },
  {
    deviceType: 'access-point',
    id: 'mist-cloud-access-points',
    management: 'cloud',
    managementLabel: 'Mist Cloud',
    models: ['AP43', 'AP63'],
    runbooks: [],
    system: 'Mist Cloud',
    vendor: 'juniper-mist',
    vendorLabel: 'Mist',
  },
  {
    deviceType: 'access-point',
    id: 'huawei-imaster-access-points',
    management: 'cloud',
    managementLabel: 'iMaster',
    models: ['AirEngine 6776-58TI'],
    runbooks: [],
    system: 'iMaster',
    vendor: 'huawei',
    vendorLabel: 'Huawei',
  },
];

function validateCommand(command) {
  if (typeof command !== 'string' || command.length === 0 || /[\r\n;]/u.test(command)) {
    throw new Error('Runbook command must be one safe line');
  }
  if (!command.startsWith('show ') && !SESSION_ONLY_COMMANDS.has(command)) {
    throw new Error(`Runbook command is outside the read-only allowlist: ${command}`);
  }
}

for (const family of families) {
  for (const runbook of family.runbooks) {
    runbook.commands.forEach(validateCommand);
    Object.freeze(runbook.commands);
    Object.freeze(runbook);
  }
  Object.freeze(family.models);
  Object.freeze(family.runbooks);
  Object.freeze(family);
}

export const runbookCatalog = Object.freeze(families);

export function runbookFamilyForDevice(device) {
  return runbookCatalog.find(
    (candidate) => candidate.vendor === device.vendor && candidate.deviceType === device.deviceType,
  );
}

export function runbookFamilyById(profileId) {
  if (typeof profileId !== 'string' || profileId.length > 120) {
    throw new ApplicationError('Perfil de runbook inválido.', {
      code: 'validation_error',
      details: { field: 'profileId' },
      statusCode: 422,
    });
  }
  const family = runbookCatalog.find(
    (candidate) => candidate.id === profileId && candidate.management === 'ssh',
  );
  if (family === undefined) throw new NotFoundError('Perfil de runbook');
  return family;
}

export function runbooksForDevice(device, profileId) {
  const family = profileId === undefined ? runbookFamilyForDevice(device) : runbookFamilyById(profileId);
  if (family === undefined || family.management !== 'ssh') return [];
  return family.runbooks;
}

export function runbookForDevice(device, runbookId, profileId) {
  if (typeof runbookId !== 'string' || runbookId.length > 120) {
    throw new ApplicationError('Runbook inválido.', {
      code: 'validation_error',
      details: { field: 'runbookId' },
      statusCode: 422,
    });
  }
  const runbook = runbooksForDevice(device, profileId).find((candidate) => candidate.id === runbookId);
  if (runbook === undefined) throw new NotFoundError('Runbook');
  return runbook;
}
