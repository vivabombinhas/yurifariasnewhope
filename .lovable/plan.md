# Simplificar painel eBay (V1)

## Objetivo

Reduzir os 9 sub-painéis atuais a **4 etapas lineares** que guiam o usuário do começo ao fim, e garantir que qualquer alteração relevante no produto marque o draft como desatualizado.

## Etapas finais

```text
1. Setup        → conta conectada + categoria + condição oficial
2. Listing Data → aspects (item specifics) + readiness consolidado
3. Draft        → criar/recriar draft no eBay (com diagnóstico embutido)
4. Publish      → seller setup automático + publish (com audit embutido)
```

Cada etapa mostra: status (ok / pendente / erro), um botão de ação primário e, quando útil, um "Detalhes" colapsado com o conteúdo técnico atual (preflight/audit raw) para debug — sem poluir a UI.

## Mapeamento dos painéis atuais

| Hoje                          | Vai para           |
|-------------------------------|--------------------|
| EbayCategoryPanel             | Etapa 1 (Setup)    |
| EbayConditionPanel            | Etapa 1 (Setup)    |
| EbayAspectsPanel              | Etapa 2 (Listing)  |
| EbayReadinessPanel            | Etapa 2 (Listing)  |
| EbayDraftPanel                | Etapa 3 (Draft)    |
| EbaySellerSetupPanel          | Etapa 4 (collapsed)|
| EbayPublishPreflightPanel     | Etapa 4 (collapsed)|
| EbayPublishAuditPanel         | Etapa 4 (collapsed)|
| EbayPublishPanel              | Etapa 4 (Publish)  |

Nenhum painel é removido — eles viram conteúdo interno das 4 etapas. Lógica de servidor (`*.functions.ts` / `*.server.ts`) fica intocada.

## Mark draft outdated em edições de produto

Hoje só `saveEbayCategory` e `saveEbayCondition` chamam `markEbayDraftOutdated`. Vamos estender para:

- edição de título, descrição, preço, condição interna (form de produto)
- adição / remoção / reordenação de fotos

Implementação: helper único `markEbayDraftOutdatedForProduct(productId)` chamado nos pontos de mutação do produto/fotos. Quando o draft está outdated, a etapa 3 mostra "Recreate draft" como ação primária e a etapa 4 fica bloqueada.

## Arquivos a criar

- `src/components/ebay/EbayWorkflowPanel.tsx` — container das 4 etapas (stepper vertical).
- `src/components/ebay/steps/StepSetup.tsx`
- `src/components/ebay/steps/StepListingData.tsx`
- `src/components/ebay/steps/StepDraft.tsx`
- `src/components/ebay/steps/StepPublish.tsx`

## Arquivos a editar

- `src/components/MarketplacePublishingPanel.tsx` — trocar 9 sub-painéis por `<EbayWorkflowPanel />`.
- `src/routes/_authenticated/products.$id.tsx` — chamar `markEbayDraftOutdatedForProduct` no save de produto e mutações de fotos.
- Criar `src/lib/marketplaces/ebay/mark-outdated.functions.ts` expondo a função.

## Não-mudanças

- Nenhuma alteração em `publish.functions.ts`, `draft.server.ts`, `taxonomy.*`, `seller-setup.*`, `publish-audit.*`. Comportamento idêntico, só apresentação.
- Painéis antigos permanecem nos arquivos (não deletar) caso queiramos voltar — apenas deixam de ser renderizados.

## Critério de aceite

1. No detalhe de um produto, a seção eBay mostra exatamente 4 etapas numeradas com status visual.
2. Cada etapa tem 1 ação primária visível; detalhes técnicos ficam atrás de "Detalhes".
3. Editar título/descrição/preço/condição interna OU mexer em fotos marca `draftOutdated=true` e a etapa Draft pede recriação.
4. Fluxo completo (categoria → condição → aspects → draft → publish) continua funcionando no Sandbox como hoje.
