## Objetivo

Estruturar a descrição dos anúncios para combinar dados ricos (item specifics, condição, frete) com uma descrição enxuta (≤900 chars). Cada marketplace renderiza o output do seu jeito.

## Mudanças

### 1. Schema (migration)
Adicionar à tabela `products`:
- `item_specifics` jsonb (array de `{name, value}`) — vira `aspects` na API do eBay
- `condition_grade` text — rótulo curto ("Used – Acceptable", "Like New", etc.)
- `condition_notes` text — detalhes ("split no canto superior direito…")
- `shipping_notes` text — origem, embalagem, manuseio

Campo `description` continua existindo, agora com limite **900 chars** (validado no frontend e na server function).

### 2. IA — novo schema de saída
`analyzeProductWithAI` passa a devolver também:
- `item_specifics: [{name, value}]` (5–12 itens relevantes)
- `condition_grade`
- `condition_notes`
- `shipping_notes`
- `description` reescrita para ≤900 chars (parágrafo enxuto + "Please review photos…")

Título, brand, category, tags, preço — **inalterados**.

### 3. UI — formulário do produto
Nas páginas `products.new`, `products.$id` e `intake`:
- Bloco "Item Specifics" — lista editável (add/remove linhas nome/valor)
- Campos `condition_grade`, `condition_notes`, `shipping_notes` (textarea curtos)
- Campo `description` ganha contador `xxx / 900` e bloqueia salvar acima do limite
- Botão "Generate with AI" preenche todos os campos novos junto com os atuais

### 4. Renderer por marketplace
Novo arquivo por provider em `src/lib/marketplaces/<id>/render.ts` com `renderListing(product)` retornando `{ title, description, aspects? }`:
- **eBay**: `aspects` = `item_specifics`; `description` = HTML simples com seções (Description, Condition Details, Shipping) montado a partir dos campos
- **Etsy / Poshmark / Depop / Facebook**: concatena tudo em texto plano (sem campo `aspects`)

O `PublishPanel`/`publishToMarketplace` passa a chamar o renderer correto antes de registrar a intenção.

## Fora de escopo
- Conectar API real do eBay (já planejado em etapas futuras)
- Mudar título / brand / category / preço
- Validações específicas por categoria do eBay (aspects obrigatórios variam por categoria — fica para a etapa de category mapping)

## Arquivos tocados
- migration nova (products)
- `src/lib/ai-suggestions.functions.ts` (schema + prompt)
- `src/routes/_authenticated/products.new.tsx`
- `src/routes/_authenticated/products.$id.tsx`
- `src/routes/_authenticated/intake.tsx`
- `src/lib/marketplaces/{ebay,etsy,facebook,poshmark,depop}/render.ts` (novos)
- `src/lib/marketplaces/publish.functions.ts` (usar renderer)
- `src/lib/i18n.tsx` (rótulos novos en/es)
