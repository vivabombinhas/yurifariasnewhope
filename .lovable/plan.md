Pela gravação, você não está errando: a tela mostra que a condição eBay ficou escondida/indireta. O sistema está mostrando “Condition mapped to eBay: LIKE_NEW” no readiness, mas não há um painel claro para trocar isso para “Used”. Além disso, o campo “Condition” dentro de “eBay Item Specifics” não é a condição real do eBay; ele é só um item specific, por isso digitar “Used” ali não corrige o erro de publicação.

Plano de ajuste:

1. Tornar a condição eBay visível e editável
- Adicionar ou reposicionar um painel claro chamado “eBay Condition”.
- Mostrar as opções válidas da categoria selecionada, por exemplo “New” e “Used” para Frames.
- Permitir selecionar “Used” e salvar antes de sincronizar/publicar.

2. Evitar confusão com “Condition” em Item Specifics
- Marcar melhor que “eBay Item Specifics > Condition” não é a condição oficial da listagem.
- Se possível, não deixar esse campo sobrescrever ou confundir a condição eBay real.

3. Bloquear publicação quando a condição não for válida para a categoria
- Se a categoria Frames não aceita LIKE_NEW, o readiness deve mostrar erro/aviso, não check verde.
- O botão de publish deve exigir uma condição válida antes de enviar para o eBay.

4. Automatizar a sugestão correta
- Quando a categoria só aceitar New/Used e o produto interno estiver Like New/Good/Acceptable/For parts, sugerir automaticamente “Used”.
- Ainda manter revisão humana antes de publicar.

5. Próximo passo depois disso
- Depois desse ajuste, o fluxo fica mais simples: escolher categoria, revisar item specifics, confirmar condição eBay, sync/publish.
- Em seguida podemos começar a Phase 2 para transformar esses passos em um assistente/fluxo único mais automático.