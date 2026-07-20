DROP POLICY IF EXISTS "admin products" ON public.products;
DROP POLICY IF EXISTS "admin sales" ON public.sales;

DROP POLICY IF EXISTS "own products" ON public.products;
DROP POLICY IF EXISTS "own sales" ON public.sales;

CREATE POLICY "own products" ON public.products
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own sales" ON public.sales
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
