export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_marketplace_drafts: {
        Row: {
          analysis_id: string
          approved: boolean
          buyer_shipping_cents: number | null
          condition_text: string
          created_at: string
          description: string
          estimated_buyer_total_cents: number | null
          id: string
          keywords: Json
          listing_price_cents: number | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          minimum_offer_cents: number | null
          price_confidence: string
          pricing_basis: string
          product_id: string
          shipping_text: string
          title: string
          updated_at: string
          validation_flags: Json
        }
        Insert: {
          analysis_id: string
          approved?: boolean
          buyer_shipping_cents?: number | null
          condition_text?: string
          created_at?: string
          description?: string
          estimated_buyer_total_cents?: number | null
          id?: string
          keywords?: Json
          listing_price_cents?: number | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          minimum_offer_cents?: number | null
          price_confidence?: string
          pricing_basis?: string
          product_id: string
          shipping_text?: string
          title?: string
          updated_at?: string
          validation_flags?: Json
        }
        Update: {
          analysis_id?: string
          approved?: boolean
          buyer_shipping_cents?: number | null
          condition_text?: string
          created_at?: string
          description?: string
          estimated_buyer_total_cents?: number | null
          id?: string
          keywords?: Json
          listing_price_cents?: number | null
          marketplace?: Database["public"]["Enums"]["marketplace"]
          minimum_offer_cents?: number | null
          price_confidence?: string
          pricing_basis?: string
          product_id?: string
          shipping_text?: string
          title?: string
          updated_at?: string
          validation_flags?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_marketplace_drafts_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "ai_product_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_marketplace_drafts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_product_analyses: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          identification: Json
          model: string
          product_id: string
          quality_flags: Json
          raw_response: Json
          status: string
          updated_at: string
          verification_answers: Json
          verification_questions: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          identification?: Json
          model: string
          product_id: string
          quality_flags?: Json
          raw_response?: Json
          status?: string
          updated_at?: string
          verification_answers?: Json
          verification_questions?: Json
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          identification?: Json
          model?: string
          product_id?: string
          quality_flags?: Json
          raw_response?: Json
          status?: string
          updated_at?: string
          verification_answers?: Json
          verification_questions?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_product_analyses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_suggestions: {
        Row: {
          accepted: boolean
          created_at: string
          created_by: string | null
          id: string
          model: string
          product_id: string
          raw: Json
          suggestion: Json
        }
        Insert: {
          accepted?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          model: string
          product_id: string
          raw: Json
          suggestion: Json
        }
        Update: {
          accepted?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string
          product_id?: string
          raw?: Json
          suggestion?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_offer_settings: {
        Row: {
          allow_offers: boolean
          auto_accept_amount_cents: number | null
          auto_accept_mode: string
          auto_accept_percentage: number | null
          id: string
          minimum_amount_cents: number | null
          minimum_mode: string
          minimum_percentage: number | null
          updated_at: string
        }
        Insert: {
          allow_offers?: boolean
          auto_accept_amount_cents?: number | null
          auto_accept_mode?: string
          auto_accept_percentage?: number | null
          id?: string
          minimum_amount_cents?: number | null
          minimum_mode?: string
          minimum_percentage?: number | null
          updated_at?: string
        }
        Update: {
          allow_offers?: boolean
          auto_accept_amount_cents?: number | null
          auto_accept_mode?: string
          auto_accept_percentage?: number | null
          id?: string
          minimum_amount_cents?: number | null
          minimum_mode?: string
          minimum_percentage?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      locations: {
        Row: {
          area: string
          box: string | null
          created_at: string
          id: string
          label: string | null
          shelf: string | null
          updated_at: string
        }
        Insert: {
          area: string
          box?: string | null
          created_at?: string
          id?: string
          label?: string | null
          shelf?: string | null
          updated_at?: string
        }
        Update: {
          area?: string
          box?: string | null
          created_at?: string
          id?: string
          label?: string | null
          shelf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      marketplace_accounts: {
        Row: {
          access_token: string
          account_name: string | null
          business_policy_ids: Json
          connected_at: string
          created_at: string
          environment: string
          error_message: string | null
          external_account_id: string | null
          id: string
          last_orders_sync_at: string | null
          last_orders_sync_attempt_at: string | null
          last_orders_sync_error: Json | null
          last_orders_sync_status: string | null
          last_refresh_at: string | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          merchant_location_key: string | null
          metadata: Json
          orders_sync_lock_at: string | null
          refresh_token: string
          scopes: string[]
          status: string
          token_expires_at: string
          updated_at: string
        }
        Insert: {
          access_token: string
          account_name?: string | null
          business_policy_ids?: Json
          connected_at?: string
          created_at?: string
          environment?: string
          error_message?: string | null
          external_account_id?: string | null
          id?: string
          last_orders_sync_at?: string | null
          last_orders_sync_attempt_at?: string | null
          last_orders_sync_error?: Json | null
          last_orders_sync_status?: string | null
          last_refresh_at?: string | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          merchant_location_key?: string | null
          metadata?: Json
          orders_sync_lock_at?: string | null
          refresh_token: string
          scopes?: string[]
          status?: string
          token_expires_at: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          account_name?: string | null
          business_policy_ids?: Json
          connected_at?: string
          created_at?: string
          environment?: string
          error_message?: string | null
          external_account_id?: string | null
          id?: string
          last_orders_sync_at?: string | null
          last_orders_sync_attempt_at?: string | null
          last_orders_sync_error?: Json | null
          last_orders_sync_status?: string | null
          last_refresh_at?: string | null
          marketplace?: Database["public"]["Enums"]["marketplace"]
          merchant_location_key?: string | null
          metadata?: Json
          orders_sync_lock_at?: string | null
          refresh_token?: string
          scopes?: string[]
          status?: string
          token_expires_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketplace_listings: {
        Row: {
          created_at: string
          error_message: string | null
          external_line_item_id: string | null
          external_listing_id: string | null
          external_order_id: string | null
          id: string
          last_error: Json | null
          last_failed_step: string | null
          last_sync_at: string | null
          listed_at: string | null
          listing_url: string | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          notes: string | null
          product_id: string
          provider_metadata: Json
          published_at: string | null
          sold_at: string | null
          status: Database["public"]["Enums"]["listing_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          external_line_item_id?: string | null
          external_listing_id?: string | null
          external_order_id?: string | null
          id?: string
          last_error?: Json | null
          last_failed_step?: string | null
          last_sync_at?: string | null
          listed_at?: string | null
          listing_url?: string | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          notes?: string | null
          product_id: string
          provider_metadata?: Json
          published_at?: string | null
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          external_line_item_id?: string | null
          external_listing_id?: string | null
          external_order_id?: string | null
          id?: string
          last_error?: Json | null
          last_failed_step?: string | null
          last_sync_at?: string | null
          listed_at?: string | null
          listing_url?: string | null
          marketplace?: Database["public"]["Enums"]["marketplace"]
          notes?: string | null
          product_id?: string
          provider_metadata?: Json
          published_at?: string | null
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_sales: {
        Row: {
          created_at: string
          external_line_item_id: string
          external_listing_id: string | null
          external_order_id: string
          fulfillment_status: string | null
          id: string
          marketplace: string
          marketplace_account_id: string
          marketplace_listing_id: string | null
          matched_at: string | null
          order_created_at: string | null
          order_modified_at: string | null
          payment_status: string | null
          processed_at: string
          processing_error: Json | null
          processing_status: string
          product_id: string | null
          quantity: number | null
          raw_order_redacted: Json | null
          sku: string | null
        }
        Insert: {
          created_at?: string
          external_line_item_id: string
          external_listing_id?: string | null
          external_order_id: string
          fulfillment_status?: string | null
          id?: string
          marketplace: string
          marketplace_account_id: string
          marketplace_listing_id?: string | null
          matched_at?: string | null
          order_created_at?: string | null
          order_modified_at?: string | null
          payment_status?: string | null
          processed_at?: string
          processing_error?: Json | null
          processing_status?: string
          product_id?: string | null
          quantity?: number | null
          raw_order_redacted?: Json | null
          sku?: string | null
        }
        Update: {
          created_at?: string
          external_line_item_id?: string
          external_listing_id?: string | null
          external_order_id?: string
          fulfillment_status?: string | null
          id?: string
          marketplace?: string
          marketplace_account_id?: string
          marketplace_listing_id?: string | null
          matched_at?: string | null
          order_created_at?: string | null
          order_modified_at?: string | null
          payment_status?: string | null
          processed_at?: string
          processing_error?: Json | null
          processing_status?: string
          product_id?: string | null
          quantity?: number | null
          raw_order_redacted?: Json | null
          sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_sales_marketplace_account_id_fkey"
            columns: ["marketplace_account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_sales_marketplace_listing_id_fkey"
            columns: ["marketplace_listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_photos: {
        Row: {
          created_at: string
          id: string
          is_cover: boolean
          position: number
          product_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_cover?: boolean
          position?: number
          product_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          is_cover?: boolean
          position?: number
          product_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_photos_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["product_status"] | null
          id: string
          note: string | null
          product_id: string
          to_status: Database["public"]["Enums"]["product_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["product_status"] | null
          id?: string
          note?: string | null
          product_id: string
          to_status: Database["public"]["Enums"]["product_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["product_status"] | null
          id?: string
          note?: string | null
          product_id?: string
          to_status?: Database["public"]["Enums"]["product_status"]
        }
        Relationships: [
          {
            foreignKeyName: "product_status_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string | null
          category_id: string | null
          condition: Database["public"]["Enums"]["product_condition"] | null
          condition_grade: string | null
          condition_notes: string | null
          created_at: string
          currency: string
          description: string
          ebay_aspects: Json
          ebay_category_confidence: number | null
          ebay_category_id: string | null
          ebay_category_name: string | null
          ebay_category_source: string | null
          ebay_condition_enum: string | null
          ebay_condition_id: number | null
          ebay_condition_name: string | null
          ebay_offer_allow: boolean | null
          ebay_offer_auto_accept_amount_cents: number | null
          ebay_offer_auto_accept_mode: string | null
          ebay_offer_auto_accept_percentage: number | null
          ebay_offer_minimum_amount_cents: number | null
          ebay_offer_minimum_mode: string | null
          ebay_offer_minimum_percentage: number | null
          ebay_offer_override: boolean
          id: string
          item_specifics: Json
          location_id: string | null
          needs_condition_reselection: boolean
          price_cents: number | null
          shipping_notes: string | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          title: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          condition?: Database["public"]["Enums"]["product_condition"] | null
          condition_grade?: string | null
          condition_notes?: string | null
          created_at?: string
          currency?: string
          description?: string
          ebay_aspects?: Json
          ebay_category_confidence?: number | null
          ebay_category_id?: string | null
          ebay_category_name?: string | null
          ebay_category_source?: string | null
          ebay_condition_enum?: string | null
          ebay_condition_id?: number | null
          ebay_condition_name?: string | null
          ebay_offer_allow?: boolean | null
          ebay_offer_auto_accept_amount_cents?: number | null
          ebay_offer_auto_accept_mode?: string | null
          ebay_offer_auto_accept_percentage?: number | null
          ebay_offer_minimum_amount_cents?: number | null
          ebay_offer_minimum_mode?: string | null
          ebay_offer_minimum_percentage?: number | null
          ebay_offer_override?: boolean
          id?: string
          item_specifics?: Json
          location_id?: string | null
          needs_condition_reselection?: boolean
          price_cents?: number | null
          shipping_notes?: string | null
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          title?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          condition?: Database["public"]["Enums"]["product_condition"] | null
          condition_grade?: string | null
          condition_notes?: string | null
          created_at?: string
          currency?: string
          description?: string
          ebay_aspects?: Json
          ebay_category_confidence?: number | null
          ebay_category_id?: string | null
          ebay_category_name?: string | null
          ebay_category_source?: string | null
          ebay_condition_enum?: string | null
          ebay_condition_id?: number | null
          ebay_condition_name?: string | null
          ebay_offer_allow?: boolean | null
          ebay_offer_auto_accept_amount_cents?: number | null
          ebay_offer_auto_accept_mode?: string | null
          ebay_offer_auto_accept_percentage?: number | null
          ebay_offer_minimum_amount_cents?: number | null
          ebay_offer_minimum_mode?: string | null
          ebay_offer_minimum_percentage?: number | null
          ebay_offer_override?: boolean
          id?: string
          item_specifics?: Json
          location_id?: string | null
          needs_condition_reselection?: boolean
          price_cents?: number | null
          shipping_notes?: string | null
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_jobs: {
        Row: {
          action: string
          attempt_count: number
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          marketplace: string
          payload: Json | null
          processed_at: string | null
          product_id: string
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          action: string
          attempt_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          marketplace: string
          payload?: Json | null
          processed_at?: string | null
          product_id: string
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          action?: string
          attempt_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          marketplace?: string
          payload?: Json | null
          processed_at?: string | null
          product_id?: string
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ebay_condition_enum_for_id: {
        Args: { _condition_id: number }
        Returns: string
      }
      record_marketplace_sale: {
        Args: {
          _external_line_item_id: string
          _external_listing_id: string
          _external_order_id: string
          _fulfillment_status: string
          _marketplace: string
          _marketplace_account_id: string
          _marketplace_listing_id: string
          _order_created_at: string
          _order_modified_at: string
          _payment_status: string
          _processing_error: Json
          _processing_status: string
          _product_id: string
          _quantity: number
          _raw_order_redacted: Json
          _sku: string
        }
        Returns: Json
      }
      release_orders_sync_lock: {
        Args: { _account_id: string }
        Returns: undefined
      }
      set_vault_secret: {
        Args: { _description?: string; _name: string; _value: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      try_acquire_orders_sync_lock: {
        Args: { _account_id: string; _ttl_seconds?: number }
        Returns: boolean
      }
    }
    Enums: {
      listing_status: "draft" | "active" | "sold" | "ended" | "removed"
      marketplace:
        | "ebay"
        | "etsy"
        | "facebook_marketplace"
        | "poshmark"
        | "depop"
      product_condition:
        | "new"
        | "like_new"
        | "very_good"
        | "good"
        | "acceptable"
        | "for_parts"
      product_status:
        | "received"
        | "photographed"
        | "draft"
        | "ready_to_list"
        | "listed"
        | "sold"
        | "shipped"
        | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      listing_status: ["draft", "active", "sold", "ended", "removed"],
      marketplace: [
        "ebay",
        "etsy",
        "facebook_marketplace",
        "poshmark",
        "depop",
      ],
      product_condition: [
        "new",
        "like_new",
        "very_good",
        "good",
        "acceptable",
        "for_parts",
      ],
      product_status: [
        "received",
        "photographed",
        "draft",
        "ready_to_list",
        "listed",
        "sold",
        "shipped",
        "archived",
      ],
    },
  },
} as const
