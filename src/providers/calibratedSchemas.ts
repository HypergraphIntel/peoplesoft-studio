/*
 * Table fingerprints (calibratedRelease.tableFingerprint: column names and types) of each
 * family's tables on its calibrated patches, read through Studio's catalog. A database on
 * another patch of the same release must match them. Regenerate when a family gains a table.
 */
export const CALIBRATED_SCHEMAS: Partial<Record<string, Record<string, Readonly<Record<string, string>>>>> = {
  'query': {
    '8.61.15': {
      'PSQRYDEFN': '1d7510e055cd2510',
      'PSQRYSELECT': 'dc9cc683068b5b06',
      'PSQRYRECORD': '0e55cd85d09a6415',
      'PSQRYFIELD': 'a3819421c1eeb731',
      'PSQRYCRITERIA': '206c840ea5629de7',
      'PSQRYEXPR': 'eb6e4f9d404c9027',
      'PSQRYBIND': '627ee4da9d5236ff'
    },
    '8.62.09': {
      'PSQRYDEFN': '1d7510e055cd2510',
      'PSQRYSELECT': 'dc9cc683068b5b06',
      'PSQRYRECORD': '0e55cd85d09a6415',
      'PSQRYFIELD': 'a3819421c1eeb731',
      'PSQRYCRITERIA': '206c840ea5629de7',
      'PSQRYEXPR': 'eb6e4f9d404c9027',
      'PSQRYBIND': '627ee4da9d5236ff'
    }
  },
  'integrationBrokerStandard': {
    '8.61.15': {
      'PSMSGDEFN': '580e231c87dee491',
      'PSMSGVER': 'aeb958c0f6ef249d',
      'PSSERVICE': '662f9eed6311c50d',
      'PSSERVICEOPR': '56e6369c584a6962',
      'PSOPERATION': '4a09317207f5cf56',
      'PSOPRVERDFN': 'd128d6f6a2ea2dc8',
      'PSOPRVERDFNPARM': '1cc21305e8fe6f13',
      'PSLSDEFN': 'a7eced018b3fb761',
      'PSLSDEFNBODY': '658285667651e970',
      'PSPHYSSCHDEFN': 'b97812172a232622',
      'PSPHYSSCHBODY': '6164612f08074359',
      'PSDOCSCMADFN': '4275d9f86c4df318',
      'PSDOCSCMADATA': '736a6933eed5d08c',
      'PSDOCJSCMADATA': '736a6933eed5d08c'
    },
    '8.62.09': {
      'PSMSGDEFN': '580e231c87dee491',
      'PSMSGVER': 'aeb958c0f6ef249d',
      'PSSERVICE': '662f9eed6311c50d',
      'PSSERVICEOPR': '56e6369c584a6962',
      'PSOPERATION': '2564ac693c281e0d',
      'PSOPRVERDFN': 'd128d6f6a2ea2dc8',
      'PSOPRVERDFNPARM': '1cc21305e8fe6f13',
      'PSLSDEFN': 'a7eced018b3fb761',
      'PSLSDEFNBODY': '658285667651e970',
      'PSPHYSSCHDEFN': 'b97812172a232622',
      'PSPHYSSCHBODY': '6164612f08074359',
      'PSDOCSCMADFN': '4275d9f86c4df318',
      'PSDOCSCMADATA': '736a6933eed5d08c',
      'PSDOCJSCMADATA': '736a6933eed5d08c'
    }
  },
  'integrationBroker': {
    '8.62.09': {
      'PSMSGDEFN': '580e231c87dee491',
      'PSMSGVER': 'aeb958c0f6ef249d',
      'PSSERVICE': '662f9eed6311c50d',
      'PSSERVICEOPR': '56e6369c584a6962',
      'PSOPERATION': '2564ac693c281e0d',
      'PSOPRVERDFN': 'd128d6f6a2ea2dc8',
      'PSOPRVERDFNPARM': '1cc21305e8fe6f13',
      'PSLSDEFN': 'a7eced018b3fb761',
      'PSLSDEFNBODY': '658285667651e970',
      'PSPHYSSCHDEFN': 'b97812172a232622',
      'PSPHYSSCHBODY': '6164612f08074359',
      'PSDOCSCMADFN': '4275d9f86c4df318',
      'PSDOCSCMADATA': '736a6933eed5d08c',
      'PSDOCJSCMADATA': '736a6933eed5d08c',
      'PSMSGREC': '98b4d894115eaa3d',
      'PSMSGFLDOVR': '0c0c414bf59296d3',
      'PSMSGPARTS': 'bbdb89d77b13a084',
      'PSMSGATTR': 'cf47109b81cd0001',
      'PSOPRHDLR': 'eb05fb8fc8fb4f96',
      'PSOPERATIONAC': '1a133e391345683b',
      'PSOPERATIONAE': 'bccdeed23ac49864',
      'PSOPERATIONCI': '5b3db2e389a76375',
      'PSOPERATIONDMS': 'f0e7018034398545',
      'PSOPERATIONURI': 'b1eaf6993a9df22d',
      'PSOPRURIDATA': '35811eea7037885e',
      'PSOPRVDCONTTYPE': 'e8148b4da27e10ff',
      'PSOPRVERQUEPARM': '2e1658f0c9a283b4',
      'PSMSGNODEDEFN': '5c6c4869dcd5528e',
      'PSNODECONPROP': '4572a09ab5a118b0',
      'PSIBRTNGDEFN': '05435146ed2af6fe',
      'PSRTNGDFNPARM': '3b3c5f2437461a14',
      'PSRTNGDFNCONPRP': 'f7784cc4aa1b5900',
      'PSRTNGDFNPROP': '5f4dc9c0145d5cbf',
      'PSIBRTNGSUBDEFN': '8cbf01e1058142e9'
    }
  },
  'oauth': {
    '8.62.09': {
      'PSPTSEC_TOKEN': 'be80608409ec1d7a',
      'PSPTSEC_AUD': '88bf58b34bd7948a',
      'PSPTSEC_ROLES': '0317b3e83a40f3d6'
    }
  }
};
