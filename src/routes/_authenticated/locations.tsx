import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { RouteError } from "@/components/RouteError";

export const Route = createFileRoute("/_authenticated/locations")({
  head: () => ({ meta: [{ title: "Locations — Inventory" }] }),
  component: LocationsPage,
  errorComponent: RouteError,
});

function LocationsPage() {
  const qc = useQueryClient();
  const [area, setArea] = useState("");
  const [shelf, setShelf] = useState("");
  const [box, setBox] = useState("");
  const [search, setSearch] = useState("");

  const list = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, area, shelf, box, label")
        .order("area")
        .order("shelf")
        .order("box");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!area.trim()) throw new Error("Area is required");
      const { error } = await supabase.from("locations").insert({
        area: area.trim(),
        shelf: shelf.trim() || null,
        box: box.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Location added");
      setArea("");
      setShelf("");
      setBox("");
      qc.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("locations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = (list.data ?? []).filter((l) =>
    l.label?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Locations</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add location</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
            className="grid grid-cols-1 sm:grid-cols-4 gap-3"
          >
            <div className="space-y-1">
              <Label htmlFor="area">Area *</Label>
              <Input id="area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Garage" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shelf">Shelf</Label>
              <Input id="shelf" value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="Shelf A" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="box">Box</Label>
              <Input id="box" value={box} onChange={(e) => setBox(e.target.value)} placeholder="Box 12" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} className="w-full">
                Add
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div>
        <Input
          placeholder="Search locations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="rounded-md border bg-background">
        {!filtered.length ? (
          <p className="p-6 text-sm text-muted-foreground">No locations.</p>
        ) : (
          <ul className="divide-y">
            {filtered.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">{l.label}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete "${l.label}"?`)) remove.mutate(l.id);
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
