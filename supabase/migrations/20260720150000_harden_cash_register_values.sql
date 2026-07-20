ALTER TABLE public.products
ADD CONSTRAINT products_price_positive CHECK (price > 0) NOT VALID;

ALTER TABLE public.sales
ADD CONSTRAINT sales_quantity_positive CHECK (quantity > 0) NOT VALID;

ALTER TABLE public.sales
ADD CONSTRAINT sales_unit_price_positive CHECK (unit_price > 0) NOT VALID;

ALTER TABLE public.sales
ADD CONSTRAINT sales_total_non_negative CHECK (total >= 0) NOT VALID;

CREATE OR REPLACE FUNCTION public.set_sale_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.total := round(NEW.quantity * NEW.unit_price, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_set_total ON public.sales;

CREATE TRIGGER sales_set_total
BEFORE INSERT OR UPDATE OF quantity, unit_price, total
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.set_sale_total();
