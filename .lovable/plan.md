# Modo Fila (Batch) — Cadastro em massa

Nova página `/products/batch` que permite cadastrar muitos produtos de uma vez, com IA agrupando fotos automaticamente e analisando em lote com 3 análises paralelas.

## Fluxo do usuário

1. **Upload em massa**: usuário solta/seleciona N fotos (de vários produtos misturados).
2. **Agrupar com IA**: clica em "Agrupar fotos" → IA visualiza todas as fotos e retorna grupos por produto (ex: fotos 1,3,7 = produto A; fotos 2,5 = produto B…).
3. **Ajuste manual** (caso IA erre): usuário pode arrastar fotos entre grupos, mesclar grupos ou separar.
4. **Analisar lote**: clica em "Analisar todos" → cria drafts (1 por grupo), faz upload das fotos, e roda `analyzeProductWithAI` com concorrência máx. 3.
5. **Revisão inline**: tabela com 1 linha por produto mostrando capa + título/marca/categoria/condição/preço editáveis + status (`pending → uploading → analyzing → ready → error`).
6. **Salvar tudo**: confirma os drafts em massa e leva para `/products`.

## Mudanças técnicas

### Backend (server functions)

**`src/lib/batch-grouping.functions.ts`** (novo)
- `groupPhotosBySimilarity({ photoIds: string[] })` — recebe IDs de fotos já em um bucket de staging (`product-photos`, em path `staging/{userId}/...`), gera URLs assinadas, e chama Lovable AI (`google/gemini-3-flash-preview`) com `Output.object` pedindo `{ groups: number[][] }`. Retorna agrupamento por índices.
- Usa `requireSupabaseAuth`.

**Staging de fotos**: reutiliza bucket `product-photos` com prefixo `staging/{userId}/{sessionId}/`. Quando um draft é criado a partir do grupo, fotos são movidas para `{productId}/`. Se sessão for descartada, é feito cleanup.

### Frontend

**`src/routes/_authenticated/products.batch.tsx`** (novo)
- Estado local: `photos: StagedPhoto[]`, `groups: { id: string; photoIndexes: number[] }[]`, `drafts: BatchDraft[]`.
- Concorrência: helper `runWithConcurrency(tasks, 3)` que processa fila de 3 em 3.
- Componentes inline (no mesmo arquivo, simples): `PhotoGrid`, `GroupCard` (com botão "separar"/"mesclar com..."), `DraftRow` (editável).

**`src/lib/concurrency.ts`** (novo, pequeno)
- `runWithConcurrency<T,R>(items: T[], limit: number, fn: (item:T, i:number) => Promise<R>): Promise<R[]>` — utilitário genérico.

**`src/routes/_authenticated/products.index.tsx`**
- Adicionar botão secundário "Cadastro em lote" ao lado do "+ Novo", apontando para `/products/batch`.

### i18n
Adicionar chaves em `src/lib/i18n.tsx`: `batch.title`, `batch.upload`, `batch.group`, `batch.grouping`, `batch.analyze`, `batch.analyzing`, `batch.saveAll`, `batch.status.pending|uploading|analyzing|ready|error`, etc.

## Escopo desta entrega (V1)

- ✅ Upload em massa + agrupamento por IA
- ✅ Ajuste manual de grupos (mover/mesclar/separar)
- ✅ Análise em lote com 3 paralelos
- ✅ Edição inline + salvar tudo
- ❌ **Não inclui**: publicar no eBay em lote (continua 1 por 1 na página do produto). Isso fica para próxima iteração se você quiser.
- ❌ Não inclui: progresso persistido (se fechar a aba, perde a sessão). Mantido simples para V1.

## Por que essa abordagem

- **Reaproveita** `analyzeProductWithAI`, `prepareImageForUpload`, bucket `product-photos`, schema atual — zero migração de banco.
- **Modular**: agrupamento e concorrência ficam em arquivos próprios, não poluem a página existente.
- **Sem regressão**: página `/products/new` (1 produto) continua intacta.
