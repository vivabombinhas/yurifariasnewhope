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
          connected_at: string
          created_at: string
          environment: string
          error_message: string | null
          external_account_id: string | null
          id: string
          last_refresh_at: string | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          metadata: Json
          refresh_token: string
          scopes: string[]
          status: string
          token_expires_at: string
          updated_at: string
        }
        Insert: {
          access_token: string
          account_name?: string | null
          connected_at?: string
          created_at?: string
          environment?: string
          error_message?: string | null
          external_account_id?: string | null
          id?: string
          last_refresh_at?: string | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          metadata?: Json
          refresh_token: string
          scopes?: string[]
          status?: string
          token_expires_at: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          account_name?: string | null
          connected_at?: string
          created_at?: string
          environment?: string
          error_message?: string | null
          external_account_id?: string | null
          id?: string
          last_refresh_at?: string | null
          marketplace?: Database["public"]["Enums"]["marketplace"]
          metadata?: Json
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
          external_listing_id: string | null
          id: string
          last_sync_at: string | null
          listed_at: string | null
          listing_url: string | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          notes: string | null
          product_id: string
          published_at: string | null
          sold_at: string | null
          status: Database["public"]["Enums"]["listing_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          external_listing_id?: string | null
          id?: string
          last_sync_at?: string | null
          listed_at?: string | null
          listing_url?: string | null
          marketplace: Database["public"]["Enums"]["marketplace"]
          notes?: string | null
          product_id: string
          published_at?: string | null
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          external_listing_id?: string | null
          id?: string
          last_sync_at?: string | null
          listed_at?: string | null
          listing_url?: string | null
          marketplace?: Database["public"]["Enums"]["marketplace"]
          notes?: string | null
          product_id?: string
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
          id: string
          item_specifics: Json
          location_id: string | null
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
          id?: string
          item_specifics?: Json
          location_id?: string | null
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
          id?: string
          item_specifics?: Json
          location_id?: string | null
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
