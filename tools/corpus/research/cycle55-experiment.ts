import { encodeProgramArtifacts } from '../../../src/peoplecode/encoder';

function test(label: string, source: string): void {
  console.log(`\n=== ${label} ===`);
  try {
    const { references } = encodeProgramArtifacts(source);
    for (const r of references) console.log('  ', JSON.stringify(r));
  } catch (e) {
    console.log('  ERROR:', e instanceof Error ? e.message : String(e));
  }
}

// Reproduce 28882's shape structurally, minimized.
test('A: BenefitPlanDetail alone (scalar, uninitialized, unused)', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:BenefitPlanDetail &oPlanDetail;
end-method;
`);

test('B: BenefitPlanDetail alone, USED via property access', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:BenefitPlanDetail &oPlanDetail;
   Local string &x;
   &x = &oPlanDetail.CoverageElect;
end-method;
`);

test('C: Contact alone (scalar, uninitialized, unused) -- isolate whether name/type matters', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:Contact &oContact;
end-method;
`);

test('D: Contact alone, USED via property access', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:Contact &oContact;
   Local string &x;
   &x = &oContact.Phone;
end-method;
`);

test('E: Contact assigned FROM a method call, then used', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:Contact &oContact;
   &oContact = %This.BenDataMgr.GetPlanProviders();
   If &oContact.Phone <> "" Then
      &oContact.Phone = "x";
   End-If;
end-method;
`);

test('F: BenefitPlanDetail assigned FROM indexed rowset access, then used (matches real shape)', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:BenefitPlanDetail &oPlanDetail;
   Local number &j;
   For &j = 1 To 5
      &oPlanDetail = %This.arrPlanDetail [&j];
      &oPlanDetail.CoverageElect = "x";
   End-For;
end-method;
`);

test('G: Resource scalar THEN array of Resource (reproduce dedup question directly)', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:Resource &oResource;
   Local array of PKG:Object:Resource &arrResource;
   &oResource = &arrResource [1];
end-method;
`);

test('H: two DIFFERENT scalar App Class locals both assigned+used, both uninitialized decls, before any executable stmt (Contact then FSASummary)', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:Contact &oContact;
   Local PKG:Object:FSASummary &oFSASummary;
   &oContact = %This.GetC();
   &oFSASummary = %This.GetF();
   &oContact.Phone = "x";
   &oFSASummary.Status = "y";
end-method;
`);

test('I: BenefitPlanDetail declared FIRST among several locals, then Contact declared after -- does position among sibling locals matter?', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG:Object:BenefitPlanDetail &oPlanDetail;
   Local PKG:Object:Contact &oContact;
   &oPlanDetail.CoverageElect = "x";
   &oContact.Phone = "y";
end-method;
`);

test('J: faithful reproduction of 28882 leading declarations + minimal usage', `
class PLAN_PROVIDERS extends PKG:Intent:IntentByPlanType
   method SetResponseData();
end-class;

method SetResponseData
   Local JsonArray &oOutJsonArr;
   Local number &i, &j;
   Local string &sDesc;

   Local PKG2:Object:BenefitPlanDetail &oPlanDetail;

   Local JsonBuilder &jbTableDefn = CreateJsonBuilder();

   Local PKG2:Object:Contact &oContact;
   Local PKG2:Object:FSASummary &oFSASummary;

   Local PKG2:Object:Resource &oResource;
   Local array of PKG2:Object:Resource &arrResource;

   %Super.SetResponseData();

   If %This.arrPlanDetail.Len > 0 Then
      For &j = 1 To %This.arrPlanDetail.Len
         &oPlanDetail = %This.arrPlanDetail [&j];
         If &oPlanDetail.IsInternalFSA = "N" Then
            &oContact = %This.BenDataMgr.GetPlanProviders(%This.EMPLID, &oPlanDetail.BenefitPlanRecId, &oPlanDetail.PlanType);
            If &oContact.Phone <> "" Then
               &jbTableDefn.AddProperty("Phone_FieldValue", &oContact.Phone);
            End-If;
            &arrResource = %This.BenDataMgr.GetPlanResource(%This.EMPLID, &oPlanDetail.BenefitPlanRecId, &oPlanDetail.PlanType);
            If &arrResource.Len > 0 Then
               &oResource = &arrResource [1];
               &jbTableDefn.AddProperty("Link1_FieldValue", &oResource.URL);
            End-If;
         Else
            &oFSASummary = %This.BenDataMgr.GetFSASummary(%This.EMPLID, &oPlanDetail.BenefitPlanRecId, &oPlanDetail.PlanType);
            &jbTableDefn.AddProperty("x", &oFSASummary.Status);
         End-If;
      End-For;
   End-If;

   %This.setOutDataArray(&oOutJsonArr);
end-method;
`);

test('K: NO initializer anywhere before Contact -- does Contact allocate?', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG2:Object:BenefitPlanDetail &oPlanDetail;
   Local PKG2:Object:Contact &oContact;
   &oPlanDetail.CoverageElect = "x";
   &oContact.Phone = "y";
end-method;
`);

test('L: plain initialized SCALAR local (not JsonBuilder) before Contact -- does that alone flip it?', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local PKG2:Object:BenefitPlanDetail &oPlanDetail;
   Local number &n = 5;
   Local PKG2:Object:Contact &oContact;
   &oPlanDetail.CoverageElect = "x";
   &oContact.Phone = "y";
end-method;
`);

test('M: same as L but BenefitPlanDetail declared AFTER the initializer too -- does it now also allocate?', `
class PLAN_PROVIDERS
   method SetResponseData();
end-class;

method SetResponseData
   Local number &n = 5;
   Local PKG2:Object:BenefitPlanDetail &oPlanDetail;
   Local PKG2:Object:Contact &oContact;
   &oPlanDetail.CoverageElect = "x";
   &oContact.Phone = "y";
end-method;
`);
