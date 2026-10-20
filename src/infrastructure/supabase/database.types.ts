export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      budget_allocations: {
        Row: {
          budget_bucket_id: string;
          budget_period_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          percentage_basis_points: number;
          updated_at: string;
        };
        Insert: {
          budget_bucket_id: string;
          budget_period_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          percentage_basis_points: number;
          updated_at?: string;
        };
        Update: {
          budget_bucket_id?: string;
          budget_period_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          percentage_basis_points?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_allocations_bucket_fkey';
            columns: ['budget_bucket_id'];
            isOneToOne: false;
            referencedRelation: 'budget_buckets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_allocations_period_fkey';
            columns: ['budget_period_id'];
            isOneToOne: false;
            referencedRelation: 'budget_periods';
            referencedColumns: ['id'];
          },
        ];
      };
      budget_buckets: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          profile_id: string;
          system_key: string | null;
          type: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name: string;
          profile_id: string;
          system_key?: string | null;
          type: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name?: string;
          profile_id?: string;
          system_key?: string | null;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_buckets_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      budget_periods: {
        Row: {
          base_currency: string;
          closed_at: string | null;
          created_at: string;
          ends_on: string;
          expected_income_minor: number | null;
          id: string;
          profile_id: string;
          starts_on: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          base_currency: string;
          closed_at?: string | null;
          created_at?: string;
          ends_on: string;
          expected_income_minor?: number | null;
          id?: string;
          profile_id: string;
          starts_on: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          base_currency?: string;
          closed_at?: string | null;
          created_at?: string;
          ends_on?: string;
          expected_income_minor?: number | null;
          id?: string;
          profile_id?: string;
          starts_on?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_periods_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      categories: {
        Row: {
          archived_at: string | null;
          budget_bucket_id: string | null;
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          profile_id: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          budget_bucket_id?: string | null;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name: string;
          profile_id: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          budget_bucket_id?: string | null;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name?: string;
          profile_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_bucket_owner_fkey';
            columns: ['budget_bucket_id', 'profile_id'];
            isOneToOne: false;
            referencedRelation: 'budget_buckets';
            referencedColumns: ['id', 'profile_id'];
          },
          {
            foreignKeyName: 'categories_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          base_currency: string;
          created_at: string;
          display_name: string;
          id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          base_currency: string;
          created_at?: string;
          display_name: string;
          id: string;
          timezone: string;
          updated_at?: string;
        };
        Update: {
          base_currency?: string;
          created_at?: string;
          display_name?: string;
          id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        Insert: {
          amount_minor: number;
          budget_period_id: string;
          category_id?: string | null;
          created_at?: string;
          currency: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          owner_profile_id: string;
          scope?: string;
          transaction_date: string;
          type: string;
          updated_at?: string;
          withdrawal_confirmed?: boolean;
        };
        Update: {
          amount_minor?: number;
          budget_period_id?: string;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          owner_profile_id?: string;
          scope?: string;
          transaction_date?: string;
          type?: string;
          updated_at?: string;
          withdrawal_confirmed?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_category_owner_fkey';
            columns: ['category_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id', 'profile_id'];
          },
          {
            foreignKeyName: 'transactions_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_period_owner_fkey';
            columns: ['budget_period_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'budget_periods';
            referencedColumns: ['id', 'profile_id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_bucket_consumption: {
        Args: { p_budget_period_id: string };
        Returns: Json;
      };
      get_received_income: {
        Args: { p_budget_period_id: string };
        Returns: number;
      };
      get_savings_availability: {
        Args: { p_budget_period_id: string };
        Returns: Json;
      };
      lock_personal_finance: { Args: never; Returns: undefined };
      prepare_initial_budget_buckets: {
        Args: never;
        Returns: {
          archived_at: string | null;
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          profile_id: string;
          system_key: string | null;
          type: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'budget_buckets';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      register_income: {
        Args: {
          p_amount_minor: number;
          p_budget_period_id: string;
          p_currency: string;
          p_description?: string;
          p_transaction_date: string;
          p_transaction_id: string;
        };
        Returns: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        SetofOptions: {
          from: '*';
          to: 'transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      register_personal_expense: {
        Args: {
          p_amount_minor: number;
          p_budget_period_id: string;
          p_category_id: string;
          p_currency: string;
          p_description?: string;
          p_transaction_date: string;
          p_transaction_id: string;
        };
        Returns: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        SetofOptions: {
          from: '*';
          to: 'transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      register_savings_movement: {
        Args: {
          p_amount_minor: number;
          p_budget_period_id: string;
          p_currency: string;
          p_description?: string;
          p_transaction_date: string;
          p_transaction_id: string;
          p_type: string;
          p_withdrawal_confirmed?: boolean;
        };
        Returns: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        SetofOptions: {
          from: '*';
          to: 'transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_budget_allocations: {
        Args: { p_allocations: Json; p_budget_period_id: string };
        Returns: {
          budget_bucket_id: string;
          budget_period_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          percentage_basis_points: number;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'budget_allocations';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      save_initial_budget: {
        Args: {
          p_allocations?: Json;
          p_base_currency: string;
          p_expected_income_minor?: number;
          p_starts_on: string;
        };
        Returns: {
          base_currency: string;
          closed_at: string | null;
          created_at: string;
          ends_on: string;
          expected_income_minor: number | null;
          id: string;
          profile_id: string;
          starts_on: string;
          status: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'budget_periods';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
