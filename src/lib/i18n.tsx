import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const SUPPORTED_LANGS = ["en", "es", "pt-BR"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = {
  en: "English",
  es: "Español",
  "pt-BR": "Português (Brasil)",
};

const STORAGE_KEY = "app.lang";

type Dict = Record<string, string>;

const en: Dict = {
  // Nav
  "nav.dashboard": "Dashboard",
  "nav.products": "Products",
  "nav.intake": "Intake",
  "nav.new": "New",
  "nav.locations": "Locations",
  "nav.publishing": "Publishing",
  "nav.settings": "Settings",
  "nav.signOut": "Sign out",
  "nav.appName": "Inventory",

  // Common
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.back": "Back",
  "common.add": "Add",
  "common.search": "Search",
  "common.loading": "Loading…",
  "common.select": "Select",
  "common.all": "All",
  "common.optional": "(optional)",
  "common.tryAgain": "Try again",
  "common.goHome": "Go home",
  "common.title": "Title",
  "common.description": "Description",
  "common.price": "Price",
  "common.priceUsd": "Price (USD)",
  "common.condition": "Condition",
  "common.brand": "Brand",
  "common.category": "Category",
  "common.location": "Location",
  "common.status": "Status",
  "common.sku": "SKU",
  "common.photos": "Photos",
  "common.camera": "Camera",
  "common.gallery": "Gallery",
  "common.untitled": "Untitled",
  "common.copied": "Copied",

  // Auth
  "auth.signIn": "Sign in",
  "auth.createAccount": "Create account",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.tagline": "Internal inventory tool",
  "auth.noAccount": "No account? Create one",
  "auth.haveAccount": "Already have an account? Sign in",
  "auth.pleaseWait": "Please wait…",
  "auth.accountCreated": "Account created. You can sign in now.",
  "auth.failed": "Authentication failed",

  // Dashboard
  "dashboard.title": "Dashboard",
  "dashboard.newProduct": "New product",
  "dashboard.recent": "Recent items",
  "dashboard.empty": "No items yet. Create your first one.",

  // Products list
  "products.title": "Products",
  "products.searchPlaceholder": "Search SKU, title, brand, category, location",
  "products.allStatuses": "All statuses",
  "products.none": "No products found.",

  // New product
  "newProduct.title": "New product",
  "newProduct.tapToAdd": "Tap to add photos",
  "newProduct.cameraOrLibrary": "Camera or library",
  "newProduct.takePhoto": "Take photo",
  "newProduct.chooseFromLibrary": "Choose from library",
  "newProduct.camera": "Camera",
  "newProduct.gallery": "Gallery",
  "newProduct.typeOrPick": "Type or pick",
  "newProduct.saveProduct": "Save product",
  "newProduct.saved": "Product saved",
  "newProduct.view": "View product",
  "newProduct.addAnother": "Add another item",
  "newProduct.duplicate": "Duplicate basic info",
  "newProduct.backToProducts": "Back to products",
  "newProduct.selectLocation": "Select location",

  // Intake
  "intake.title": "Fast Intake",
  "intake.subtitle": "Photos → location → AI → save & next.",
  "intake.recommended": "Recommended workflow",
  "intake.recommendedFlow": "Photos → AI → Review → Save",
  "intake.today": "Today",
  "intake.items": "items",
  "intake.stepPhotos": "1. Photos",
  "intake.stepLocation": "2. Location",
  "intake.stepAnalyze": "3. Analyze with AI",
  "intake.stepReview": "4. Review",
  "intake.analyze": "Analyze with AI",
  "intake.analyzing": "Analyzing…",
  "intake.saveNext": "Save & Next",
  "intake.noLocations": "No locations yet —",
  "intake.createOne": "create one",
  "intake.showMore": "Show more",
  "intake.hideAdvanced": "Hide advanced",
  "intake.verify": "Verify",
  "intake.photosUploaded": "Photos already uploaded for",
  "intake.addPhotoFirst": "Add at least one photo first.",
  "intake.aiReady": "AI ready — review and save.",

  // Locations
  "locations.title": "Locations",
  "locations.add": "Add location",
  "locations.area": "Area",
  "locations.shelf": "Shelf",
  "locations.box": "Box",
  "locations.searchPlaceholder": "Search locations",
  "locations.none": "No locations.",
  "locations.areaRequired": "Area is required",
  "locations.added": "Location added",
  "locations.created": "Location created",
  "locations.newLocation": "New location",
  "locations.deleteConfirm": "Delete",

  // Product detail
  "detail.copyFullListing": "Copy full listing",
  "detail.copyTitle": "Title",
  "detail.copyDescription": "Description",
  "detail.quickActions": "Quick actions",
  "detail.details": "Details",
  "detail.statusHistory": "Status history",
  "detail.noHistory": "No history.",
  "detail.marketplaceTracking": "Marketplace tracking",
  "detail.listingUrl": "Listing URL",
  "detail.notFound": "Product not found.",
  "detail.deleteConfirm": "Delete this product and all its photos?",
  "detail.deleted": "Deleted",
  "detail.saved": "Saved",
  "detail.saveChanges": "Save changes",
  "detail.skuCopied": "SKU copied",
  "detail.fullCopied": "Full listing copied",

  // Settings
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.languageHelp":
    "Interface language. AI-generated listings stay in English.",

  // Product statuses
  "status.received": "Received",
  "status.photographed": "Photographed",
  "status.draft": "Draft",
  "status.ready_to_list": "Ready to list",
  "status.listed": "Listed",
  "status.sold": "Sold",
  "status.shipped": "Shipped",
  "status.archived": "Archived",
  "status.active": "Active",
  "status.ended": "Ended",
  "status.removed": "Removed",

  // Conditions
  "condition.new": "New",
  "condition.like_new": "Like new",
  "condition.very_good": "Very good",
  "condition.good": "Good",
  "condition.acceptable": "Acceptable",
  "condition.for_parts": "For parts",

  // Errors
  "error.pageTitle": "This page didn't load",
  "error.pageBody": "Something went wrong on our end. You can try refreshing or head back home.",
  "error.notFoundTitle": "Page not found",
  "error.notFoundBody": "The page you're looking for doesn't exist or has been moved.",
};

const es: Dict = {
  "nav.dashboard": "Panel",
  "nav.products": "Productos",
  "nav.intake": "Ingreso",
  "nav.new": "Nuevo",
  "nav.locations": "Ubicaciones",
  "nav.publishing": "Publicación",
  "nav.settings": "Ajustes",
  "nav.signOut": "Cerrar sesión",
  "nav.appName": "Inventario",

  "common.save": "Guardar",
  "common.saving": "Guardando…",
  "common.cancel": "Cancelar",
  "common.delete": "Eliminar",
  "common.back": "Volver",
  "common.add": "Añadir",
  "common.search": "Buscar",
  "common.loading": "Cargando…",
  "common.select": "Seleccionar",
  "common.all": "Todos",
  "common.optional": "(opcional)",
  "common.tryAgain": "Reintentar",
  "common.goHome": "Ir al inicio",
  "common.title": "Título",
  "common.description": "Descripción",
  "common.price": "Precio",
  "common.priceUsd": "Precio (USD)",
  "common.condition": "Condición",
  "common.brand": "Marca",
  "common.category": "Categoría",
  "common.location": "Ubicación",
  "common.status": "Estado",
  "common.sku": "SKU",
  "common.photos": "Fotos",
  "common.camera": "Cámara",
  "common.gallery": "Galería",
  "common.untitled": "Sin título",
  "common.copied": "Copiado",

  "auth.signIn": "Iniciar sesión",
  "auth.createAccount": "Crear cuenta",
  "auth.email": "Correo electrónico",
  "auth.password": "Contraseña",
  "auth.tagline": "Herramienta interna de inventario",
  "auth.noAccount": "¿Sin cuenta? Crear una",
  "auth.haveAccount": "¿Ya tienes cuenta? Iniciar sesión",
  "auth.pleaseWait": "Por favor espera…",
  "auth.accountCreated": "Cuenta creada. Ya puedes iniciar sesión.",
  "auth.failed": "Error de autenticación",

  "dashboard.title": "Panel",
  "dashboard.newProduct": "Nuevo producto",
  "dashboard.recent": "Artículos recientes",
  "dashboard.empty": "Aún no hay artículos. Crea el primero.",

  "products.title": "Productos",
  "products.searchPlaceholder": "Buscar SKU, título, marca, categoría, ubicación",
  "products.allStatuses": "Todos los estados",
  "products.none": "No se encontraron productos.",

  "newProduct.title": "Nuevo producto",
  "newProduct.tapToAdd": "Toca para añadir fotos",
  "newProduct.cameraOrLibrary": "Cámara o galería",
  "newProduct.takePhoto": "Tomar foto",
  "newProduct.chooseFromLibrary": "Elegir de galería",
  "newProduct.camera": "Cámara",
  "newProduct.gallery": "Galería",
  "newProduct.typeOrPick": "Escribe o elige",
  "newProduct.saveProduct": "Guardar producto",
  "newProduct.saved": "Producto guardado",
  "newProduct.view": "Ver producto",
  "newProduct.addAnother": "Añadir otro artículo",
  "newProduct.duplicate": "Duplicar datos básicos",
  "newProduct.backToProducts": "Volver a productos",
  "newProduct.selectLocation": "Seleccionar ubicación",

  "intake.title": "Ingreso Rápido",
  "intake.subtitle": "Fotos → ubicación → IA → guardar y siguiente.",
  "intake.recommended": "Flujo recomendado",
  "intake.recommendedFlow": "Fotos → IA → Revisar → Guardar",
  "intake.today": "Hoy",
  "intake.items": "artículos",
  "intake.stepPhotos": "1. Fotos",
  "intake.stepLocation": "2. Ubicación",
  "intake.stepAnalyze": "3. Analizar con IA",
  "intake.stepReview": "4. Revisar",
  "intake.analyze": "Analizar con IA",
  "intake.analyzing": "Analizando…",
  "intake.saveNext": "Guardar y siguiente",
  "intake.noLocations": "Aún no hay ubicaciones —",
  "intake.createOne": "crear una",
  "intake.showMore": "Mostrar más",
  "intake.hideAdvanced": "Ocultar avanzado",
  "intake.verify": "Verificar",
  "intake.photosUploaded": "Fotos ya subidas para",
  "intake.addPhotoFirst": "Añade al menos una foto primero.",
  "intake.aiReady": "IA lista — revisa y guarda.",

  "locations.title": "Ubicaciones",
  "locations.add": "Añadir ubicación",
  "locations.area": "Área",
  "locations.shelf": "Estante",
  "locations.box": "Caja",
  "locations.searchPlaceholder": "Buscar ubicaciones",
  "locations.none": "Sin ubicaciones.",
  "locations.areaRequired": "El área es obligatoria",
  "locations.added": "Ubicación añadida",
  "locations.created": "Ubicación creada",
  "locations.newLocation": "Nueva ubicación",
  "locations.deleteConfirm": "Eliminar",

  "detail.copyFullListing": "Copiar anuncio completo",
  "detail.copyTitle": "Título",
  "detail.copyDescription": "Descripción",
  "detail.quickActions": "Acciones rápidas",
  "detail.details": "Detalles",
  "detail.statusHistory": "Historial de estado",
  "detail.noHistory": "Sin historial.",
  "detail.marketplaceTracking": "Seguimiento de marketplaces",
  "detail.listingUrl": "URL del anuncio",
  "detail.notFound": "Producto no encontrado.",
  "detail.deleteConfirm": "¿Eliminar este producto y todas sus fotos?",
  "detail.deleted": "Eliminado",
  "detail.saved": "Guardado",
  "detail.saveChanges": "Guardar cambios",
  "detail.skuCopied": "SKU copiado",
  "detail.fullCopied": "Anuncio completo copiado",

  "settings.title": "Ajustes",
  "settings.language": "Idioma",
  "settings.languageHelp":
    "Idioma de la interfaz. Los anuncios generados por IA siguen en inglés.",

  "status.received": "Recibido",
  "status.photographed": "Fotografiado",
  "status.draft": "Borrador",
  "status.ready_to_list": "Listo para publicar",
  "status.listed": "Publicado",
  "status.sold": "Vendido",
  "status.shipped": "Enviado",
  "status.archived": "Archivado",
  "status.active": "Activo",
  "status.ended": "Finalizado",
  "status.removed": "Retirado",

  "condition.new": "Nuevo",
  "condition.like_new": "Como nuevo",
  "condition.very_good": "Muy bueno",
  "condition.good": "Bueno",
  "condition.acceptable": "Aceptable",
  "condition.for_parts": "Para piezas",

  "error.pageTitle": "Esta página no se cargó",
  "error.pageBody": "Algo salió mal. Intenta recargar o vuelve al inicio.",
  "error.notFoundTitle": "Página no encontrada",
  "error.notFoundBody": "La página que buscas no existe o ha sido movida.",
};

const ptBR: Dict = {
  "nav.dashboard": "Painel",
  "nav.products": "Produtos",
  "nav.intake": "Entrada",
  "nav.new": "Novo",
  "nav.locations": "Locais",
  "nav.publishing": "Publicação",
  "nav.settings": "Configurações",
  "nav.signOut": "Sair",
  "nav.appName": "Inventário",

  "common.save": "Salvar",
  "common.saving": "Salvando…",
  "common.cancel": "Cancelar",
  "common.delete": "Excluir",
  "common.back": "Voltar",
  "common.add": "Adicionar",
  "common.search": "Buscar",
  "common.loading": "Carregando…",
  "common.select": "Selecionar",
  "common.all": "Todos",
  "common.optional": "(opcional)",
  "common.tryAgain": "Tentar novamente",
  "common.goHome": "Ir para o início",
  "common.title": "Título",
  "common.description": "Descrição",
  "common.price": "Preço",
  "common.priceUsd": "Preço (USD)",
  "common.condition": "Condição",
  "common.brand": "Marca",
  "common.category": "Categoria",
  "common.location": "Local",
  "common.status": "Status",
  "common.sku": "SKU",
  "common.photos": "Fotos",
  "common.camera": "Câmera",
  "common.gallery": "Galeria",
  "common.untitled": "Sem título",
  "common.copied": "Copiado",

  "auth.signIn": "Entrar",
  "auth.createAccount": "Criar conta",
  "auth.email": "E-mail",
  "auth.password": "Senha",
  "auth.tagline": "Ferramenta interna de inventário",
  "auth.noAccount": "Sem conta? Criar uma",
  "auth.haveAccount": "Já tem conta? Entrar",
  "auth.pleaseWait": "Aguarde…",
  "auth.accountCreated": "Conta criada. Você já pode entrar.",
  "auth.failed": "Falha na autenticação",

  "dashboard.title": "Painel",
  "dashboard.newProduct": "Novo produto",
  "dashboard.recent": "Itens recentes",
  "dashboard.empty": "Nenhum item ainda. Crie o primeiro.",

  "products.title": "Produtos",
  "products.searchPlaceholder": "Buscar SKU, título, marca, categoria, local",
  "products.allStatuses": "Todos os status",
  "products.none": "Nenhum produto encontrado.",

  "newProduct.title": "Novo produto",
  "newProduct.tapToAdd": "Toque para adicionar fotos",
  "newProduct.cameraOrLibrary": "Câmera ou galeria",
  "newProduct.takePhoto": "Tirar foto",
  "newProduct.chooseFromLibrary": "Escolher da galeria",
  "newProduct.camera": "Câmera",
  "newProduct.gallery": "Galeria",
  "newProduct.typeOrPick": "Digite ou escolha",
  "newProduct.saveProduct": "Salvar produto",
  "newProduct.saved": "Produto salvo",
  "newProduct.view": "Ver produto",
  "newProduct.addAnother": "Adicionar outro item",
  "newProduct.duplicate": "Duplicar dados básicos",
  "newProduct.backToProducts": "Voltar para produtos",
  "newProduct.selectLocation": "Selecionar local",

  "intake.title": "Entrada Rápida",
  "intake.subtitle": "Fotos → local → IA → salvar e próximo.",
  "intake.recommended": "Fluxo recomendado",
  "intake.recommendedFlow": "Fotos → IA → Revisar → Salvar",
  "intake.today": "Hoje",
  "intake.items": "itens",
  "intake.stepPhotos": "1. Fotos",
  "intake.stepLocation": "2. Local",
  "intake.stepAnalyze": "3. Analisar com IA",
  "intake.stepReview": "4. Revisar",
  "intake.analyze": "Analisar com IA",
  "intake.analyzing": "Analisando…",
  "intake.saveNext": "Salvar e próximo",
  "intake.noLocations": "Nenhum local ainda —",
  "intake.createOne": "criar um",
  "intake.showMore": "Mostrar mais",
  "intake.hideAdvanced": "Ocultar avançado",
  "intake.verify": "Verificar",
  "intake.photosUploaded": "Fotos já enviadas para",
  "intake.addPhotoFirst": "Adicione pelo menos uma foto primeiro.",
  "intake.aiReady": "IA pronta — revise e salve.",

  "locations.title": "Locais",
  "locations.add": "Adicionar local",
  "locations.area": "Área",
  "locations.shelf": "Prateleira",
  "locations.box": "Caixa",
  "locations.searchPlaceholder": "Buscar locais",
  "locations.none": "Sem locais.",
  "locations.areaRequired": "Área é obrigatória",
  "locations.added": "Local adicionado",
  "locations.created": "Local criado",
  "locations.newLocation": "Novo local",
  "locations.deleteConfirm": "Excluir",

  "detail.copyFullListing": "Copiar anúncio completo",
  "detail.copyTitle": "Título",
  "detail.copyDescription": "Descrição",
  "detail.quickActions": "Ações rápidas",
  "detail.details": "Detalhes",
  "detail.statusHistory": "Histórico de status",
  "detail.noHistory": "Sem histórico.",
  "detail.marketplaceTracking": "Acompanhamento de marketplaces",
  "detail.listingUrl": "URL do anúncio",
  "detail.notFound": "Produto não encontrado.",
  "detail.deleteConfirm": "Excluir este produto e todas as fotos?",
  "detail.deleted": "Excluído",
  "detail.saved": "Salvo",
  "detail.saveChanges": "Salvar alterações",
  "detail.skuCopied": "SKU copiado",
  "detail.fullCopied": "Anúncio completo copiado",

  "settings.title": "Configurações",
  "settings.language": "Idioma",
  "settings.languageHelp":
    "Idioma da interface. Anúncios gerados pela IA permanecem em inglês.",

  "status.received": "Recebido",
  "status.photographed": "Fotografado",
  "status.draft": "Rascunho",
  "status.ready_to_list": "Pronto para anunciar",
  "status.listed": "Anunciado",
  "status.sold": "Vendido",
  "status.shipped": "Enviado",
  "status.archived": "Arquivado",
  "status.active": "Ativo",
  "status.ended": "Encerrado",
  "status.removed": "Removido",

  "condition.new": "Novo",
  "condition.like_new": "Como novo",
  "condition.very_good": "Muito bom",
  "condition.good": "Bom",
  "condition.acceptable": "Aceitável",
  "condition.for_parts": "Para peças",

  "error.pageTitle": "Esta página não carregou",
  "error.pageBody": "Algo deu errado. Tente recarregar ou volte ao início.",
  "error.notFoundTitle": "Página não encontrada",
  "error.notFoundBody": "A página que você procura não existe ou foi movida.",
};

const DICTIONARIES: Record<Lang, Dict> = { en, es, "pt-BR": ptBR };

function readStoredLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && (SUPPORTED_LANGS as readonly string[]).includes(v)) return v as Lang;
  } catch {
    // ignore
  }
  return "en";
}

type I18nContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Hydrate from localStorage on mount (avoids SSR mismatch).
  useEffect(() => {
    const stored = readStoredLang();
    if (stored !== lang) setLangState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string) => {
      return DICTIONARIES[lang][key] ?? DICTIONARIES.en[key] ?? key;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback so components don't crash if used outside provider (e.g. tests).
    return {
      lang: "en" as Lang,
      setLang: () => {},
      t: (k: string) => DICTIONARIES.en[k] ?? k,
    };
  }
  return ctx;
}

export function useT() {
  return useI18n().t;
}

/** Translate a product status enum value. */
export function tStatus(t: (k: string) => string, status: string): string {
  return t(`status.${status}`);
}

/** Translate a product condition enum value. */
export function tCondition(t: (k: string) => string, condition: string): string {
  return t(`condition.${condition}`);
}
