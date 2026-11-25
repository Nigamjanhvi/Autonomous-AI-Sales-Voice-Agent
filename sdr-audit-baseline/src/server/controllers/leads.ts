import { createLead, deleteLead, getLead, listLeads, updateLead } from "../services/leads.js";
import { createLeadBody, leadIdParams, leadQuery, updateLeadBody, validated } from "../http/validation.js";

export const listLeadRecords = validated({ query: leadQuery }, async ({ query }, res) => {
  res.json(await listLeads(query));
});
export const readLeadRecord = validated({ params: leadIdParams }, async ({ params }, res) => {
  res.json({ lead: await getLead(params.leadId) });
});
export const createLeadRecord = validated({ body: createLeadBody }, async ({ body }, res) => {
  res.status(201).json({ lead: await createLead(body) });
});
export const updateLeadRecord = validated({ params: leadIdParams, body: updateLeadBody }, async ({ params, body }, res) => {
  res.json({ lead: await updateLead(params.leadId, body) });
});
export const deleteLeadRecord = validated({ params: leadIdParams }, async ({ params }, res) => {
  await deleteLead(params.leadId);
  res.status(204).end();
});
