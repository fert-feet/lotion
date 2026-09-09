import Footer from "@/src/marketing/footer";
import Heading from "@/src/marketing/heading";
import Heroes from "@/src/marketing/heroes";
import LandingText from "@/src/marketing/landingText";

const MarketingPage = () => {
  return (
    <div className="min-h-full flex flex-col">
      <div className="flex flex-col items-center gap-y-16 md:gap-y-24 flex-1 px-6 pb-20 pt-10">
        <Heading />
        <Heroes />
        <LandingText />
      </div>
      <Footer />
    </div>
  );
}

export default MarketingPage;
